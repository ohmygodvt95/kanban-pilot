/**
 * In-process job runner.
 *
 * Polls the `jobs` table, claims jobs atomically and executes them:
 *   run_agent      spawn the executor CLI (detached, see process.ts), stream its
 *                  events into run_events + the EventBus, finalise the run
 *   setup_worktree run the project's setup script, then enqueue run_agent
 *   post_run       hand over to the post-run pipeline
 *   run_tests      re-run the project's test script for an attempt
 *
 * Agents survive a restart of agent-kanban: `recover()` re-attaches to still
 * running pids and finalises runs whose process already ended.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attempt, Job, Run, RunEventType } from '@agent-kanban/shared';
import type { CoreContext } from '../context.js';
import { getExecutor } from '../executors/registry.js';
import type { ExecutorAdapter, ExecutorInput, NormalizedEvent } from '../executors/types.js';
import { CHAT_SCHEMA, REFINE_SCHEMA } from '../prompts/prompts.js';
import type {
  PostRunJobPayload,
  RunAgentJobPayload,
  RunTestsJobPayload,
  SetupJobPayload,
} from '../runs/runs.js';
import { attachmentFilePath } from '../state/tasks.js';
import { errorMessage } from '../util/errors.js';
import {
  type AgentExit,
  type AgentProcess,
  attachAgent,
  formatCommand,
  isPidAlive,
  LOG_FILES,
  readExitFile,
  runScript,
  spawnAgent,
} from './process.js';

export interface RunnerHooks {
  /** Called when a run starts executing (task → DOING(running)). */
  onRunStarted(run: Run): Promise<void>;
  /** Called after a run row is finalised; enqueues the post-run pipeline. */
  onRunFinished(run: Run): Promise<void>;
  /** Post-run pipeline entry. */
  postRun(payload: PostRunJobPayload): Promise<void>;
  /** Setup script failed → task DOING(error). */
  onSetupFailed(payload: SetupJobPayload, message: string): Promise<void>;
  /**
   * The CLI could not resume the session of `run`. Return true if a replacement
   * run (without resume) was created, in which case `run` is closed quietly.
   */
  onSessionLost(run: Run): Promise<boolean>;
  /** Test script finished for an attempt (from run_tests job or post-run). */
  onTestsFinished(attempt: Attempt, ok: boolean): Promise<void>;
}

export interface RunnerOptions {
  pollIntervalMs?: number;
  setupTimeoutMs?: number;
  testTimeoutMs?: number;
}

/** Map a normalised event to the coarse `run_events.type` column. */
const eventTypeFor = (ev: NormalizedEvent): RunEventType => {
  switch (ev.type) {
    case 'init':
      return 'system';
    case 'assistant_text':
    case 'tool_use':
      return 'assistant';
    case 'tool_result':
      return 'user';
    case 'result':
      return 'result';
    case 'stderr':
      return 'stderr';
    default:
      return 'raw';
  }
};

/** Everything collected from a process's streams while supervising it. */
interface Collected {
  sessionId: string | null;
  result: Extract<NormalizedEvent, { type: 'result' }> | null;
  stderr: string[];
}

export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = true;
  private readonly inflight = new Set<Promise<void>>();
  private readonly processes = new Map<string, AgentProcess>();
  readonly lockId = `pid:${process.pid}`;
  private readonly pollIntervalMs: number;
  private readonly setupTimeoutMs: number;
  private readonly testTimeoutMs: number;

  constructor(
    private readonly ctx: CoreContext,
    private readonly hooks: RunnerHooks,
    opts: RunnerOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;
    this.setupTimeoutMs = opts.setupTimeoutMs ?? 15 * 60_000;
    this.testTimeoutMs = opts.testTimeoutMs ?? 10 * 60_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
    void this.tick();
  }

  /**
   * Stop scheduling. Agent processes keep running unless `killProcesses` is set;
   * a later `recover()` re-attaches to them.
   */
  async stop(opts: { killProcesses?: boolean } = {}): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (opts.killProcesses) for (const p of this.processes.values()) p.kill(2000);
    if (opts.killProcesses) await Promise.allSettled([...this.inflight]);
  }

  get activeRunIds(): string[] {
    return [...this.processes.keys()];
  }

  /** Kill a running agent process (SIGTERM → SIGKILL). Returns false if not supervised here. */
  cancelRun(runId: string): boolean {
    const p = this.processes.get(runId);
    if (!p) return false;
    p.kill();
    return true;
  }

  /**
   * Recover from a previous agent-kanban process:
   *  - runs still `running` whose pid is alive are re-attached (their events continue);
   *  - runs whose process already ended are finalised from the log files;
   *  - anything else (no log dir, dead pid without exit file) fails with a clear message.
   * Stale `running` jobs are closed; queued jobs are simply picked up again.
   */
  async recover(): Promise<{ attached: number; finalized: number; failed: number }> {
    const stats = { attached: 0, finalized: 0, failed: 0 };
    for (const job of await this.ctx.store.runningJobs()) {
      if (job.locked_by === this.lockId) continue;
      await this.ctx.store.finishJob(job.id, 'done', {
        error: 'closed by recovery (previous process ended)',
      });
    }
    for (const run of await this.ctx.store.listRunsByStatus(['running'])) {
      if (this.processes.has(run.id)) continue;
      const logDir = run.log_dir;
      const exitCode = logDir ? readExitFile(logDir) : undefined;
      if (logDir && run.pid && (exitCode !== undefined || isPidAlive(run.pid))) {
        this.track(this.attach(run, logDir, run.pid));
        if (exitCode !== undefined) stats.finalized++;
        else stats.attached++;
        continue;
      }
      const failed = await this.ctx.store.updateRun(run.id, {
        status: 'failed',
        error_message: 'agent-kanban restarted and the agent process could not be found',
        finished_at: new Date().toISOString(),
        pid: null,
      });
      stats.failed++;
      await this.hooks.onRunFinished(failed);
    }
    return stats;
  }

  /** One scheduler pass. Public for tests. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const queued = await this.ctx.store.queuedJobs();
      const claimedProjects = new Map<string, number>();
      for (const job of queued) {
        if (job.kind === 'run_agent') {
          const payload = job.payload as RunAgentJobPayload;
          const project = await this.ctx.store.findProject(payload.projectId);
          if (!project) {
            await this.ctx.store.finishJob(job.id, 'failed', { error: 'project no longer exists' });
            continue;
          }
          const running =
            (await this.ctx.store.countRunningRuns(project.id)) + (claimedProjects.get(project.id) ?? 0);
          if (running >= project.max_concurrent_runs) continue;
          claimedProjects.set(project.id, (claimedProjects.get(project.id) ?? 0) + 1);
        }
        const locked = await this.ctx.store.lockJob(job.id, this.lockId);
        if (!locked) continue;
        this.track(this.execute(locked));
      }
    } catch (err) {
      this.ctx.logger.error({ err: errorMessage(err) }, 'runner tick failed');
    } finally {
      this.ticking = false;
    }
  }

  /** Wait until no jobs are in flight (tests). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track(p: Promise<void>) {
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p)).catch(() => {});
  }

  private async execute(job: Job): Promise<void> {
    try {
      switch (job.kind) {
        case 'run_agent':
          await this.runAgent(job.payload as RunAgentJobPayload);
          break;
        case 'setup_worktree':
          await this.setupWorktree(job, job.payload as SetupJobPayload);
          break;
        case 'post_run':
          await this.hooks.postRun(job.payload as PostRunJobPayload);
          break;
        case 'run_tests':
          await this.runTests(job.payload as RunTestsJobPayload);
          break;
        default:
          throw new Error(`unknown job kind ${job.kind}`);
      }
      const done = await this.ctx.store.finishJob(job.id, 'done');
      this.ctx.events.emit('job.done', { job: done });
    } catch (err) {
      const message = errorMessage(err);
      this.ctx.logger.error({ job: job.id, kind: job.kind, err: message }, 'job failed');
      const failed = await this.ctx.store.finishJob(job.id, 'failed', { error: message }).catch(() => job);
      const payload = job.payload as Partial<RunAgentJobPayload>;
      this.ctx.events.emit('job.failed', {
        project_id: payload.projectId ?? null,
        job: failed,
        error: message,
      });
      // A failing job must never leave a run stuck in queued/running.
      if (payload.runId && job.kind !== 'post_run') {
        const run = await this.ctx.store.findRun(payload.runId);
        if (run && (run.status === 'queued' || run.status === 'running')) {
          const updated = await this.ctx.store.updateRun(run.id, {
            status: 'failed',
            error_message: message,
            finished_at: new Date().toISOString(),
          });
          await this.hooks
            .onRunFinished(updated)
            .catch((e) => this.ctx.logger.error({ err: errorMessage(e) }, 'onRunFinished failed'));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // setup / tests
  // ---------------------------------------------------------------------------

  private async setupWorktree(job: Job, payload: SetupJobPayload): Promise<void> {
    const attempt = await this.ctx.store.getAttempt(payload.attemptId);
    this.ctx.logger.info({ attempt: attempt.id }, 'running setup script');
    const res = await runScript(payload.script, attempt.worktree_path, this.setupTimeoutMs);
    await this.ctx.store.finishJob(job.id, res.ok ? 'done' : 'failed', {
      payload: { ...payload, log: res.output.slice(-20_000) },
      error: res.ok ? undefined : `setup script exited with ${res.exitCode}`,
    });
    if (!res.ok) {
      const tail = res.output.trim().split('\n').slice(-15).join('\n');
      const message = `setup script failed (exit ${res.exitCode}${res.timedOut ? ', timeout' : ''}):\n${tail}`;
      const run = await this.ctx.store.getRun(payload.runId);
      await this.ctx.store.updateRun(run.id, {
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
      });
      await this.hooks.onSetupFailed(payload, message);
      return;
    }
    const { attemptId: _a, script: _s, log: _l, ...runPayload } = payload;
    await this.ctx.store.enqueueJob('run_agent', runPayload satisfies RunAgentJobPayload);
  }

  /** Execute the project's test script in the attempt's worktree and store the result. */
  async runTestsFor(attempt: Attempt, script: string): Promise<boolean> {
    const res = await runScript(script, attempt.worktree_path, this.testTimeoutMs);
    const updated = await this.ctx.store.updateAttempt(attempt.id, {
      last_test_output: res.output,
      last_test_ok: res.ok,
    });
    await this.hooks.onTestsFinished(updated, res.ok);
    return res.ok;
  }

  private async runTests(payload: RunTestsJobPayload): Promise<void> {
    const attempt = await this.ctx.store.getAttempt(payload.attemptId);
    const project = await this.ctx.store.getProject(payload.projectId);
    if (!project.test_script?.trim() || attempt.status !== 'active') return;
    await this.runTestsFor(attempt, project.test_script);
  }

  // ---------------------------------------------------------------------------
  // agent runs
  // ---------------------------------------------------------------------------

  /** Build the executor input for a run from project/task/attempt settings. */
  private async buildInput(
    run: Run,
    adapter: ExecutorAdapter,
  ): Promise<{ input: ExecutorInput; cwd: string; timeoutMs: number }> {
    const store = this.ctx.store;
    const task = await store.getTask(run.task_id);
    const project = await store.getProject(task.project_id);
    const attempt = run.attempt_id ? await store.getAttempt(run.attempt_id) : null;
    const cwd = attempt?.worktree_path ?? project.repo_path;
    const readOnly = run.kind === 'refine' || run.kind === 'chat';
    const schema = run.kind === 'refine' ? REFINE_SCHEMA : run.kind === 'chat' ? CHAT_SCHEMA : undefined;
    // Images attached to the comments this run consumes (chat / feedback).
    const attachmentPaths = (await store.commentsConsumedBy(run.id))
      .flatMap((c) => c.attachments)
      .map((a) => attachmentFilePath(this.ctx.paths.attachmentsRoot, a));
    const input: ExecutorInput = {
      cwd,
      prompt: run.prompt,
      mode: readOnly ? 'refine' : 'execute',
      attachments: attachmentPaths.length ? attachmentPaths : undefined,
      resumeSessionId:
        adapter.supportsResume && run.resumed_from_session_id ? run.resumed_from_session_id : undefined,
      outputSchema: adapter.supportsStructuredOutput ? schema : undefined,
      model: task.model ?? project.model ?? undefined,
      maxBudgetUsd: project.max_budget_usd ?? undefined,
    };
    if (input.outputSchema) {
      // Some CLIs (Codex) only take a schema file; write it next to the run's logs.
      const logDir = join(this.ctx.paths.logsRoot, run.id);
      mkdirSync(logDir, { recursive: true });
      const file = join(logDir, 'output-schema.json');
      writeFileSync(file, JSON.stringify(input.outputSchema));
      input.outputSchemaFile = file;
    }
    return { input, cwd, timeoutMs: project.run_timeout_minutes * 60_000 };
  }

  /** Stream handlers shared by spawn and attach: persist events and collect what finalisation needs. */
  private streamHandlers(run: Run, adapter: ExecutorAdapter, collected: Collected) {
    const store = this.ctx.store;
    let queue: Promise<void> = Promise.resolve();
    const persist = (type: RunEventType, payload: unknown) => {
      queue = queue
        .then(() => store.appendRunEvent(run, type, payload).then(() => undefined))
        .catch((err) => this.ctx.logger.error({ err: errorMessage(err) }, 'failed to persist run event'));
      return queue;
    };
    return {
      onStdoutLine: (line: string) => {
        const parsed = adapter.parseLine(line);
        if (!parsed) return;
        for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
          if (ev.type === 'init') collected.sessionId = ev.sessionId;
          if (ev.type === 'result') {
            collected.result = ev;
            if (ev.sessionId) collected.sessionId = ev.sessionId;
          }
          if (ev.type === 'stderr') collected.stderr.push(ev.text);
          void persist(eventTypeFor(ev), ev);
        }
      },
      onStderrLine: (line: string) => {
        if (!line.trim()) return;
        collected.stderr.push(line);
        void persist('stderr', { type: 'stderr', text: line, raw: line });
      },
      flush: () => queue,
    };
  }

  private async runAgent(payload: RunAgentJobPayload): Promise<void> {
    const store = this.ctx.store;
    let run = await store.getRun(payload.runId);
    if (run.status !== 'queued') {
      this.ctx.logger.info({ run: run.id, status: run.status }, 'skipping run (not queued)');
      return;
    }
    const adapter = getExecutor(this.ctx.executors, run.executor);
    const { input, cwd, timeoutMs } = await this.buildInput(run, adapter);
    const command = adapter.buildCommand(input);
    const logDir = join(this.ctx.paths.logsRoot, run.id);
    run = await store.updateRun(run.id, {
      status: 'running',
      command: formatCommand(command),
      log_dir: logDir,
      started_at: new Date().toISOString(),
    });
    await this.hooks.onRunStarted(run);

    const collected: Collected = { sessionId: null, result: null, stderr: [] };
    const handlers = this.streamHandlers(run, adapter, collected);
    const proc = spawnAgent({ cwd, command, timeoutMs, logDir, logger: this.ctx.logger, ...handlers });
    if (proc.pid) run = await store.updateRun(run.id, { pid: proc.pid });
    this.processes.set(run.id, proc);
    const exit = await proc.done;
    this.processes.delete(run.id);
    await handlers.flush();
    await this.finalize(run, adapter, exit, collected);
  }

  /** Re-attach to a run started by a previous process (or finalise it if it already ended). */
  private async attach(run: Run, logDir: string, pid: number): Promise<void> {
    const store = this.ctx.store;
    const adapter = getExecutor(this.ctx.executors, run.executor);
    const collected: Collected = { sessionId: run.session_id, result: null, stderr: [] };
    const handlers = this.streamHandlers(run, adapter, collected);
    const skip = await store.countRunEventLines(run.id);
    const task = await store.getTask(run.task_id);
    const project = await store.getProject(task.project_id);
    const elapsed = run.started_at ? Date.now() - new Date(run.started_at).getTime() : 0;
    const timeoutMs = Math.max(30_000, project.run_timeout_minutes * 60_000 - elapsed);
    this.ctx.logger.info(
      { run: run.id, pid, skip },
      existsSync(join(logDir, LOG_FILES.exit)) ? 'finalising run from logs' : 're-attaching to running agent',
    );
    const proc = attachAgent({
      pid,
      logDir,
      skipStdoutLines: skip.stdout,
      skipStderrLines: skip.stderr,
      timeoutMs,
      logger: this.ctx.logger,
      ...handlers,
    });
    this.processes.set(run.id, proc);
    const exit = await proc.done;
    this.processes.delete(run.id);
    await handlers.flush();
    await this.finalize(run, adapter, exit, collected);
  }

  /** Derive the run status from the exit info + result event, persist it and notify hooks. */
  private async finalize(
    run: Run,
    adapter: ExecutorAdapter,
    exit: AgentExit,
    collected: Collected,
  ): Promise<void> {
    const store = this.ctx.store;
    const res = collected.result;
    const task = await store.getTask(run.task_id);
    const project = await store.getProject(task.project_id);
    const stderrTail = collected.stderr.slice(-10).join('\n').slice(0, 2000);
    let status: Run['status'];
    let error: string | null = null;
    if (exit.cancelled) {
      status = 'cancelled';
      error = 'cancelled by user';
    } else if (exit.timedOut) {
      status = 'failed';
      error = `timeout after ${project.run_timeout_minutes} minutes`;
    } else if (exit.spawnError) {
      status = 'failed';
      error = `could not start ${adapter.displayName}: ${exit.spawnError}`;
    } else if (exit.exitCode !== 0) {
      status = 'failed';
      error = `${adapter.displayName} exited with code ${exit.exitCode ?? '?'}${exit.signal ? ` (${exit.signal})` : ''}${
        res && !res.ok ? `: ${res.subtype}` : ''
      }${stderrTail ? `\n${stderrTail}` : ''}`;
    } else if (res && !res.ok) {
      status = 'failed';
      error = `${adapter.displayName} reported ${res.subtype}${res.resultText ? `: ${res.resultText.slice(0, 500)}` : ''}`;
    } else if (!res) {
      status = 'failed';
      error = `${adapter.displayName} exited without a result event${stderrTail ? `\n${stderrTail}` : ''}`;
    } else {
      status = 'succeeded';
    }

    const updated = await store.updateRun(run.id, {
      status,
      exit_code: exit.exitCode,
      session_id: collected.sessionId,
      result_subtype: res?.subtype ?? null,
      structured_output: res?.structuredOutput ?? null,
      result_text: res?.resultText ?? null,
      cost_usd: res?.costUsd ?? null,
      num_turns: res?.numTurns ?? null,
      error_message: error,
      pid: null,
      finished_at: new Date().toISOString(),
    });
    this.ctx.logger.info(
      { run: run.id, status, cost: updated.cost_usd, turns: updated.num_turns },
      'run finished',
    );

    // Session lost (e.g. CLI upgraded, cache cleared): retry once without --resume.
    if (
      status === 'failed' &&
      run.resumed_from_session_id &&
      !run.fallback_of_run_id &&
      adapter.classifyFailure?.({
        exitCode: exit.exitCode,
        stderr: collected.stderr.join('\n'),
        resultSubtype: res?.subtype,
      }) === 'session_not_found'
    ) {
      try {
        if (await this.hooks.onSessionLost(updated)) {
          await store.updateRun(run.id, {
            error_message: `${error}\n→ session not found; retried automatically without resume`,
          });
          return;
        }
      } catch (err) {
        this.ctx.logger.error({ run: run.id, err: errorMessage(err) }, 'session-lost fallback failed');
      }
    }
    await this.hooks.onRunFinished(updated);
  }
}
