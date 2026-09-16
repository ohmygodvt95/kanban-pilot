import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttemptService } from './attempts/attempts.js';
import type { CoreContext } from './context.js';
import { type DatabaseHandle, openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { EventBus } from './events/bus.js';
import { createDefaultRegistry, type ExecutorRegistry } from './executors/registry.js';
import { listWorktrees, pruneWorktrees } from './git/git.js';
import { PostRunPipeline } from './postrun/postrun.js';
import { ProjectService } from './projects.js';
import { RefinementService } from './refinement/refinement.js';
import { JobRunner, type RunnerOptions } from './runner/runner.js';
import { RunService } from './runs/runs.js';
import { TaskService } from './state/tasks.js';
import { Store } from './store/store.js';
import { errorMessage } from './util/errors.js';
import { type Logger, silentLogger } from './util/logger.js';
import { type CorePaths, defaultPaths } from './util/paths.js';

export interface CoreOptions {
  paths?: Partial<CorePaths>;
  /** Override adapters (tests inject fake executors). */
  executors?: Partial<ExecutorRegistry>;
  logger?: Logger;
  runner?: RunnerOptions;
  /** Built-in template dir; defaults to packages/core/templates. */
  builtinTemplatesDir?: string;
}

export interface Core {
  ctx: CoreContext;
  db: DatabaseHandle;
  events: EventBus;
  store: Store;
  projects: ProjectService;
  tasks: TaskService;
  attempts: AttemptService;
  runs: RunService;
  refinement: RefinementService;
  runner: JobRunner;
  /** Recover state + start the job runner. */
  start(): Promise<void>;
  /** Stop the runner (optionally killing agent processes) and close the DB. */
  stop(opts?: { killProcesses?: boolean }): Promise<void>;
}

function builtinTemplates(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'templates'),
    join(here, '..', '..', 'templates'),
    join(here, 'templates'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(here, '..', 'templates');
}

export function createCore(options: CoreOptions = {}): Core {
  const paths: CorePaths = { ...defaultPaths(), ...options.paths };
  const logger = options.logger ?? silentLogger;
  const db = openDatabase(paths.dbPath);
  const { applied } = runMigrations(db.sqlite);
  if (applied.length) logger.info({ applied }, 'applied migrations');

  const events = new EventBus();
  const store = new Store(db.db, events);
  const executors: ExecutorRegistry = { ...createDefaultRegistry(), ...options.executors };
  const ctx: CoreContext = {
    store,
    events,
    executors,
    paths,
    templateDirs: [paths.userTemplatesDir, options.builtinTemplatesDir ?? builtinTemplates()],
    logger,
  };

  const attempts = new AttemptService(ctx);
  const runs = new RunService(ctx);
  // late-bound to break the tasks ↔ refinement ↔ runner cycle
  let tasks: TaskService;
  let refinement: RefinementService;
  let runner: JobRunner;
  let postRun: PostRunPipeline;
  tasks = new TaskService(ctx, { attempts, runs, refinement: () => refinement, runner: () => runner });
  refinement = new RefinementService(ctx, { runs, tasks: () => tasks });
  postRun = new PostRunPipeline(ctx, { tasks: () => tasks, attempts, refinement });
  runner = new JobRunner(
    ctx,
    {
      async onRunStarted(run) {
        if (run.kind === 'refine') return;
        const task = await store.getTask(run.task_id);
        if (task.column === 'doing' && task.substate === 'queued') {
          await tasks.transition(task.id, 'doing', 'system', { substate: 'running' });
        }
      },
      async onRunFinished(run) {
        const task = await store.getTask(run.task_id);
        await store.enqueueJob('post_run', { runId: run.id, taskId: task.id, projectId: task.project_id });
      },
      postRun: (payload) => postRun.handle(payload.runId),
      async onSetupFailed(payload, message) {
        const task = await store.getTask(payload.taskId);
        if (task.column === 'doing') {
          await tasks.transition(task.id, 'doing', 'system', { substate: 'error', error_message: message });
        }
      },
    },
    options.runner,
  );
  const projects = new ProjectService(ctx);

  async function reconcileWorktrees() {
    const active = await store.listActiveAttempts();
    const byProject = new Map<string, string[]>();
    for (const p of await store.listProjects()) {
      try {
        await pruneWorktrees(p.repo_path);
        byProject.set(p.id, await listWorktrees(p.repo_path));
      } catch (err) {
        logger.warn({ project: p.id, err: errorMessage(err) }, 'cannot inspect repo');
      }
    }
    for (const a of active) {
      const task = await store.findTask(a.task_id);
      if (!task) continue;
      const known = byProject.get(task.project_id);
      if (!known || known.includes(a.worktree_path)) continue;
      logger.warn(
        { attempt: a.id, path: a.worktree_path },
        'worktree missing on disk; marking attempt discarded',
      );
      await store.updateAttempt(a.id, { status: 'discarded' });
      if (task.current_attempt_id === a.id && (task.column === 'doing' || task.column === 'review')) {
        await store.setTaskState(task.id, 'todo', 'ready', {
          current_attempt_id: null,
          last_error: 'worktree disappeared while the app was stopped; attempt discarded',
        });
      }
    }
  }

  return {
    ctx,
    db,
    events,
    store,
    projects,
    tasks,
    attempts,
    runs,
    refinement,
    runner,
    async start() {
      const recovered = await runner.recoverStaleJobs();
      if (recovered.jobs || recovered.runs)
        logger.warn(recovered, 'recovered stale jobs/runs from previous process');
      await reconcileWorktrees();
      runner.start();
    },
    async stop(opts) {
      await runner.stop(opts);
      db.close();
    },
  };
}
