import type {
  Attachment,
  Attempt,
  Column,
  Comment,
  Job,
  Project,
  RefinementQuestion,
  Run,
  RunEvent,
  RunEventType,
  Substate,
  Task,
} from '@agent-kanban/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  attachments,
  attempts,
  comments,
  jobs,
  projects,
  refinementQuestions,
  runEvents,
  runs,
  tasks,
} from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { notFound } from '../util/errors.js';
import { newId, nowIso } from '../util/ids.js';

type ProjectRow = typeof projects.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

const toProject = (r: ProjectRow): Project => r;
interface TaskAggregates {
  total_cost_usd: number;
  unconsumed_feedback: number;
}
const toTask = (r: TaskRow, agg: TaskAggregates = { total_cost_usd: 0, unconsumed_feedback: 0 }): Task => ({
  ...r,
  ...agg,
});
const toAttempt = (r: AttemptRow): Attempt => r;
const toRun = (r: RunRow): Run => ({ ...r, structured_output: r.structured_output ?? null });
const toJob = (r: JobRow): Job => r;

/**
 * Thin data-access layer over Drizzle. Update methods emit bus events so every
 * mutation is observable by transports (SSE) without the services remembering to.
 */
export class Store {
  constructor(
    readonly db: Database,
    readonly events: EventBus,
  ) {}

  // ---- projects -------------------------------------------------------------
  async listProjects(): Promise<Project[]> {
    return (await this.db.select().from(projects).orderBy(asc(projects.created_at))).map(toProject);
  }

  async findProject(id: string): Promise<Project | null> {
    const r = await this.db.query.projects.findFirst({ where: eq(projects.id, id) });
    return r ? toProject(r) : null;
  }

  async getProject(id: string): Promise<Project> {
    const p = await this.findProject(id);
    if (!p) throw notFound('project', id);
    return p;
  }

  async findProjectByPath(repoPath: string): Promise<Project | null> {
    const r = await this.db.query.projects.findFirst({ where: eq(projects.repo_path, repoPath) });
    return r ? toProject(r) : null;
  }

  async insertProject(
    values: Omit<typeof projects.$inferInsert, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Project> {
    const now = nowIso();
    const row = { ...values, id: newId(), created_at: now, updated_at: now };
    await this.db.insert(projects).values(row);
    return this.getProject(row.id);
  }

  async updateProject(id: string, patch: Partial<typeof projects.$inferInsert>): Promise<Project> {
    await this.db
      .update(projects)
      .set({ ...patch, updated_at: nowIso() })
      .where(eq(projects.id, id));
    return this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  // ---- tasks ----------------------------------------------------------------
  private async taskAggregates(taskIds: string[]): Promise<Map<string, TaskAggregates>> {
    const map = new Map<string, TaskAggregates>();
    if (taskIds.length === 0) return map;
    const costs = await this.db
      .select({ task_id: runs.task_id, total: sql<number | null>`sum(${runs.cost_usd})` })
      .from(runs)
      .where(inArray(runs.task_id, taskIds))
      .groupBy(runs.task_id);
    const feedback = await this.db
      .select({ task_id: comments.task_id, n: count() })
      .from(comments)
      .where(
        and(
          inArray(comments.task_id, taskIds),
          inArray(comments.kind, ['feedback', 'chat']),
          isNull(comments.consumed_by_run_id),
        ),
      )
      .groupBy(comments.task_id);
    for (const id of taskIds) map.set(id, { total_cost_usd: 0, unconsumed_feedback: 0 });
    for (const c of costs) map.get(c.task_id)!.total_cost_usd = Number(c.total ?? 0);
    for (const f of feedback) map.get(f.task_id)!.unconsumed_feedback = f.n;
    return map;
  }

  async listTasks(projectId: string): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.project_id, projectId))
      .orderBy(asc(tasks.position), asc(tasks.created_at));
    const agg = await this.taskAggregates(rows.map((r) => r.id));
    return rows.map((r) => toTask(r, agg.get(r.id)));
  }

  async findTask(id: string): Promise<Task | null> {
    const r = await this.db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!r) return null;
    const agg = await this.taskAggregates([id]);
    return toTask(r, agg.get(id));
  }

  async getTask(id: string): Promise<Task> {
    const t = await this.findTask(id);
    if (!t) throw notFound('task', id);
    return t;
  }

  async nextPosition(projectId: string, column: Column): Promise<number> {
    const [row] = await this.db
      .select({ max: sql<number | null>`max(${tasks.position})` })
      .from(tasks)
      .where(and(eq(tasks.project_id, projectId), eq(tasks.column, column)));
    return (row?.max ?? 0) + 1;
  }

  async insertTask(
    values: Omit<typeof tasks.$inferInsert, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Task> {
    const now = nowIso();
    const row = { ...values, id: newId(), created_at: now, updated_at: now };
    await this.db.insert(tasks).values(row);
    const task = await this.getTask(row.id);
    this.events.emit('task.updated', { project_id: task.project_id, task });
    return task;
  }

  async updateTask(id: string, patch: Partial<typeof tasks.$inferInsert>): Promise<Task> {
    await this.db
      .update(tasks)
      .set({ ...patch, updated_at: nowIso() })
      .where(eq(tasks.id, id));
    const task = await this.getTask(id);
    this.events.emit('task.updated', { project_id: task.project_id, task });
    return task;
  }

  async deleteTask(id: string): Promise<void> {
    const task = await this.getTask(id);
    await this.db.delete(tasks).where(eq(tasks.id, id));
    this.events.emit('task.deleted', { project_id: task.project_id, task_id: id });
  }

  // ---- attempts -------------------------------------------------------------
  async findAttempt(id: string): Promise<Attempt | null> {
    const r = await this.db.query.attempts.findFirst({ where: eq(attempts.id, id) });
    return r ? toAttempt(r) : null;
  }

  async getAttempt(id: string): Promise<Attempt> {
    const a = await this.findAttempt(id);
    if (!a) throw notFound('attempt', id);
    return a;
  }

  async listAttempts(taskId: string): Promise<Attempt[]> {
    return (
      await this.db
        .select()
        .from(attempts)
        .where(eq(attempts.task_id, taskId))
        .orderBy(asc(attempts.created_at))
    ).map(toAttempt);
  }

  async listActiveAttempts(): Promise<Attempt[]> {
    return (await this.db.select().from(attempts).where(eq(attempts.status, 'active'))).map(toAttempt);
  }

  async insertAttempt(
    values: Omit<typeof attempts.$inferInsert, 'created_at' | 'updated_at'>,
  ): Promise<Attempt> {
    const now = nowIso();
    await this.db.insert(attempts).values({ ...values, created_at: now, updated_at: now });
    const attempt = await this.getAttempt(values.id);
    await this.emitAttempt(attempt);
    return attempt;
  }

  async updateAttempt(id: string, patch: Partial<typeof attempts.$inferInsert>): Promise<Attempt> {
    await this.db
      .update(attempts)
      .set({ ...patch, updated_at: nowIso() })
      .where(eq(attempts.id, id));
    const attempt = await this.getAttempt(id);
    await this.emitAttempt(attempt);
    return attempt;
  }

  private async emitAttempt(attempt: Attempt) {
    const task = await this.getTask(attempt.task_id);
    this.events.emit('attempt.updated', { project_id: task.project_id, attempt });
  }

  // ---- runs -----------------------------------------------------------------
  async findRun(id: string): Promise<Run | null> {
    const r = await this.db.query.runs.findFirst({ where: eq(runs.id, id) });
    return r ? toRun(r) : null;
  }

  async getRun(id: string): Promise<Run> {
    const r = await this.findRun(id);
    if (!r) throw notFound('run', id);
    return r;
  }

  async listRuns(taskId: string): Promise<Run[]> {
    return (
      await this.db.select().from(runs).where(eq(runs.task_id, taskId)).orderBy(asc(runs.created_at))
    ).map(toRun);
  }

  /** Runs that are queued or running for a task. */
  async activeRuns(taskId: string): Promise<Run[]> {
    return (
      await this.db
        .select()
        .from(runs)
        .where(and(eq(runs.task_id, taskId), inArray(runs.status, ['queued', 'running'])))
    ).map(toRun);
  }

  async countRunningRuns(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(runs)
      .innerJoin(tasks, eq(runs.task_id, tasks.id))
      .where(and(eq(tasks.project_id, projectId), eq(runs.status, 'running')));
    return row?.n ?? 0;
  }

  async listRunsByStatus(status: Run['status'][]): Promise<Run[]> {
    return (await this.db.select().from(runs).where(inArray(runs.status, status))).map(toRun);
  }

  /** Latest run for an attempt that produced a session id (for resume). */
  async lastSessionRun(attemptId: string): Promise<Run | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.attempt_id, attemptId), sql`${runs.session_id} IS NOT NULL`))
      .orderBy(desc(runs.created_at))
      .limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async lastRefineRun(taskId: string): Promise<Run | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.task_id, taskId), eq(runs.kind, 'refine'), eq(runs.status, 'succeeded')))
      .orderBy(desc(runs.created_at))
      .limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async countRuns(taskId: string, kind: Run['kind'], status?: Run['status']): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(runs)
      .where(
        and(eq(runs.task_id, taskId), eq(runs.kind, kind), status ? eq(runs.status, status) : undefined),
      );
    return row?.n ?? 0;
  }

  async insertRun(values: Omit<typeof runs.$inferInsert, 'id' | 'created_at'>): Promise<Run> {
    const row = { ...values, id: newId(), created_at: nowIso() };
    await this.db.insert(runs).values(row);
    const run = await this.getRun(row.id);
    await this.emitRun(run);
    return run;
  }

  async updateRun(id: string, patch: Partial<typeof runs.$inferInsert>): Promise<Run> {
    await this.db.update(runs).set(patch).where(eq(runs.id, id));
    const run = await this.getRun(id);
    await this.emitRun(run);
    return run;
  }

  private async emitRun(run: Run) {
    const task = await this.getTask(run.task_id);
    this.events.emit('run.updated', { project_id: task.project_id, run });
  }

  // ---- run events -----------------------------------------------------------
  async appendRunEvent(run: Run, type: RunEventType, payload: unknown): Promise<RunEvent> {
    const [last] = await this.db
      .select({ seq: sql<number | null>`max(${runEvents.seq})` })
      .from(runEvents)
      .where(eq(runEvents.run_id, run.id));
    const seq = (last?.seq ?? 0) + 1;
    const created_at = nowIso();
    const inserted = await this.db
      .insert(runEvents)
      .values({ run_id: run.id, seq, type, payload, created_at })
      .returning({ id: runEvents.id });
    const event: RunEvent = { id: inserted[0]?.id ?? 0, run_id: run.id, seq, type, payload, created_at };
    const task = await this.getTask(run.task_id);
    this.events.emit('run.event', {
      project_id: task.project_id,
      task_id: task.id,
      run_id: run.id,
      seq,
      event,
    });
    return event;
  }

  /** Number of persisted events per stream, used to skip lines when re-attaching to a live process. */
  async countRunEventLines(runId: string): Promise<{ stdout: number; stderr: number }> {
    const rows = await this.db
      .select({ type: runEvents.type, n: count() })
      .from(runEvents)
      .where(eq(runEvents.run_id, runId))
      .groupBy(runEvents.type);
    let stdout = 0;
    let stderr = 0;
    for (const r of rows) {
      if (r.type === 'stderr') stderr += r.n;
      else stdout += r.n;
    }
    return { stdout, stderr };
  }

  /**
   * Retention: delete the event streams of runs that finished more than `days`
   * ago and whose task is DONE. Run metadata (cost, status, summary) is kept.
   */
  async pruneRunEvents(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const stale = await this.db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(tasks, eq(runs.task_id, tasks.id))
      .where(
        and(eq(tasks.column, 'done'), sql`${runs.finished_at} IS NOT NULL`, lte(runs.finished_at, cutoff)),
      );
    if (stale.length === 0) return 0;
    const ids = stale.map((r) => r.id);
    const [before] = await this.db
      .select({ n: count() })
      .from(runEvents)
      .where(inArray(runEvents.run_id, ids));
    await this.db.delete(runEvents).where(inArray(runEvents.run_id, ids));
    return before?.n ?? 0;
  }

  async listRunEvents(runId: string, after = 0, limit = 5000): Promise<RunEvent[]> {
    return (
      await this.db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.run_id, runId), gt(runEvents.seq, after)))
        .orderBy(asc(runEvents.seq))
        .limit(limit)
    ).map((r) => ({ ...r, type: r.type }));
  }

  // ---- comments -------------------------------------------------------------
  async listComments(taskId: string): Promise<Comment[]> {
    return this.withAttachments(
      await this.db
        .select()
        .from(comments)
        .where(eq(comments.task_id, taskId))
        .orderBy(asc(comments.created_at)),
    );
  }

  /** Attach the `attachments` array to raw comment rows. */
  private async withAttachments(rows: (typeof comments.$inferSelect)[]): Promise<Comment[]> {
    if (rows.length === 0) return [];
    const files = await this.db
      .select()
      .from(attachments)
      .where(
        inArray(
          attachments.comment_id,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(attachments.created_at));
    const byComment = new Map<string, Attachment[]>();
    for (const f of files) byComment.set(f.comment_id, [...(byComment.get(f.comment_id) ?? []), f]);
    return rows.map((r) => ({ ...r, attachments: byComment.get(r.id) ?? [] }));
  }

  async findComment(id: string): Promise<Comment | null> {
    const row = await this.db.query.comments.findFirst({ where: eq(comments.id, id) });
    return row ? ((await this.withAttachments([row]))[0] ?? null) : null;
  }

  async insertAttachment(values: Omit<typeof attachments.$inferInsert, 'created_at'>): Promise<Attachment> {
    const row = { ...values, created_at: nowIso() };
    await this.db.insert(attachments).values(row);
    return row;
  }

  async findAttachment(id: string): Promise<Attachment | null> {
    return (await this.db.query.attachments.findFirst({ where: eq(attachments.id, id) })) ?? null;
  }

  async unconsumedFeedback(taskId: string): Promise<Comment[]> {
    return this.withAttachments(
      await this.db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.task_id, taskId),
            inArray(comments.kind, ['feedback', 'chat']),
            isNull(comments.consumed_by_run_id),
          ),
        )
        .orderBy(asc(comments.created_at)),
    );
  }

  async allFeedback(taskId: string): Promise<Comment[]> {
    return this.withAttachments(
      await this.db
        .select()
        .from(comments)
        .where(and(eq(comments.task_id, taskId), inArray(comments.kind, ['feedback', 'chat'])))
        .orderBy(asc(comments.created_at)),
    );
  }

  async insertComment(values: Omit<typeof comments.$inferInsert, 'id' | 'created_at'>): Promise<Comment> {
    const row = { ...values, id: newId(), created_at: nowIso() };
    await this.db.insert(comments).values(row);
    const c = await this.findComment(row.id);
    if (!c) throw notFound('comment', row.id);
    await this.touchTask(values.task_id);
    return c;
  }

  async commentsConsumedBy(runId: string): Promise<Comment[]> {
    return this.withAttachments(
      await this.db
        .select()
        .from(comments)
        .where(eq(comments.consumed_by_run_id, runId))
        .orderBy(asc(comments.created_at)),
    );
  }

  async markCommentsConsumed(ids: string[], runId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(comments).set({ consumed_by_run_id: runId }).where(inArray(comments.id, ids));
  }

  async deleteComment(id: string): Promise<void> {
    const c = await this.findComment(id);
    if (!c) throw notFound('comment', id);
    await this.db.delete(comments).where(eq(comments.id, id));
    await this.touchTask(c.task_id);
  }

  // ---- refinement questions -------------------------------------------------
  async listQuestions(taskId: string): Promise<RefinementQuestion[]> {
    return await this.db
      .select()
      .from(refinementQuestions)
      .where(eq(refinementQuestions.task_id, taskId))
      .orderBy(asc(refinementQuestions.created_at));
  }

  async findQuestion(id: string): Promise<RefinementQuestion | null> {
    return (
      (await this.db.query.refinementQuestions.findFirst({ where: eq(refinementQuestions.id, id) })) ?? null
    );
  }

  async insertQuestions(taskId: string, runId: string, questions: string[]): Promise<RefinementQuestion[]> {
    const now = nowIso();
    const rows = questions.map((q, i) => ({
      id: newId(),
      task_id: taskId,
      run_id: runId,
      question: q,
      // keep insertion order stable even within the same millisecond
      created_at: new Date(Date.parse(now) + i).toISOString(),
    }));
    if (rows.length) await this.db.insert(refinementQuestions).values(rows);
    return this.listQuestions(taskId);
  }

  async answerQuestion(id: string, answer: string): Promise<RefinementQuestion> {
    await this.db
      .update(refinementQuestions)
      .set({ answer, answered_at: nowIso() })
      .where(eq(refinementQuestions.id, id));
    const q = await this.findQuestion(id);
    if (!q) throw notFound('question', id);
    return q;
  }

  // ---- jobs -----------------------------------------------------------------
  async enqueueJob(kind: string, payload: unknown, runAfter?: Date): Promise<Job> {
    const now = nowIso();
    const row = {
      id: newId(),
      kind,
      payload,
      status: 'queued' as const,
      attempts_count: 0,
      run_after: (runAfter ?? new Date()).toISOString(),
      created_at: now,
      updated_at: now,
    };
    await this.db.insert(jobs).values(row);
    return toJob({ ...row, locked_by: null, error: null, payload: row.payload });
  }

  async queuedJobs(): Promise<Job[]> {
    return (
      await this.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'queued'), isNull(jobs.locked_by), lte(jobs.run_after, nowIso())))
        .orderBy(asc(jobs.created_at))
    ).map(toJob);
  }

  /** Atomically claim a queued job. Returns null if someone else got it. */
  async lockJob(id: string, lockedBy: string): Promise<Job | null> {
    const rows = await this.db
      .update(jobs)
      .set({
        status: 'running',
        locked_by: lockedBy,
        attempts_count: sql`${jobs.attempts_count} + 1`,
        updated_at: nowIso(),
      })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'queued'), isNull(jobs.locked_by)))
      .returning();
    return rows[0] ? toJob(rows[0]) : null;
  }

  async finishJob(
    id: string,
    status: 'done' | 'failed',
    extra: { error?: string; payload?: unknown } = {},
  ): Promise<Job> {
    const patch: Partial<typeof jobs.$inferInsert> = { status, locked_by: null, updated_at: nowIso() };
    if (extra.error !== undefined) patch.error = extra.error;
    if (extra.payload !== undefined) patch.payload = extra.payload;
    const rows = await this.db.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
    if (!rows[0]) throw notFound('job', id);
    return toJob(rows[0]);
  }

  async runningJobs(): Promise<Job[]> {
    return (await this.db.select().from(jobs).where(eq(jobs.status, 'running'))).map(toJob);
  }

  async findJob(id: string): Promise<Job | null> {
    const r = await this.db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    return r ? toJob(r) : null;
  }

  // ---- helpers --------------------------------------------------------------
  /** Re-emit a task (e.g. after comments changed) without modifying columns. */
  async touchTask(id: string): Promise<Task> {
    return this.updateTask(id, {});
  }

  async setTaskState(
    id: string,
    column: Column,
    substate: Substate | null,
    extra: Partial<typeof tasks.$inferInsert> = {},
  ) {
    return this.updateTask(id, { column, substate, ...extra });
  }
}
