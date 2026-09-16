/**
 * Issue tracker glue: mirrors task column changes onto linked issues through the
 * project's status map (best-effort, never blocks a transition) and imports new
 * issues on each integration's poll interval (default 30 s).
 */
import type { Column, Task } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import type { IntegrationService } from './integrations.js';
import { columnForStatus, type SyncContext, statusComment, statusForColumn } from './providers/index.js';
import type { ExternalIssue } from './providers/types.js';
import { errorMessage } from './util/errors.js';

export interface IssueSyncDeps {
  integrations: () => IntegrationService;
  /** Creates backlog tasks from external ids; provided by ProjectService. */
  importIssues(projectId: string, externalIds: string[]): Promise<Task[]>;
}

export class IssueService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: IssueSyncDeps,
  ) {}

  /**
   * Push the new column to the linked issue: remote status from the status map
   * (if `sync_status`) and a short comment (if `sync_comments`). Errors are logged
   * and surfaced on the task's `last_error`; the transition itself never rolls back.
   */
  async syncTask(prev: Pick<Task, 'column'>, task: Task): Promise<void> {
    if (prev.column === task.column || !task.source_external_id || !task.source_provider) return;
    const link = await this.deps.integrations().provider(task.project_id);
    if (!link || link.row.provider !== task.source_provider) return;
    const attempt = task.current_attempt_id
      ? await this.ctx.store.findAttempt(task.current_attempt_id)
      : null;
    const ctx: SyncContext = {
      column: task.column,
      branch: attempt?.branch ?? null,
      prUrl: attempt?.pr_url ?? null,
      taskTitle: task.title,
    };
    try {
      const remote = statusForColumn(link.row.status_map, task.column);
      if (link.row.sync_status && remote) await link.provider.setStatus(task.source_external_id, remote, ctx);
      if (link.row.sync_comments) await link.provider.addComment(task.source_external_id, statusComment(ctx));
      this.ctx.logger.info(
        { task: task.id, issue: task.source_external_id, column: task.column, remote },
        'issue synced',
      );
    } catch (err) {
      this.ctx.logger.warn({ task: task.id, err: errorMessage(err) }, 'issue sync failed');
      await this.ctx.store
        .updateTask(task.id, { last_error: `issue sync failed: ${errorMessage(err)}` })
        .catch(() => {});
    }
  }

  /**
   * Push edited title/description to the linked issue and remember the remote
   * watermark so the next poll does not pull the same text back. Best effort.
   */
  async pushText(task: Task, patch: { title?: string; description?: string }): Promise<void> {
    if (!task.source_external_id || !task.source_provider) return;
    const link = await this.deps.integrations().provider(task.project_id);
    if (!link || link.row.provider !== task.source_provider) return;
    try {
      const issue = await link.provider.updateIssue(task.source_external_id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { body: patch.description } : {}),
      });
      await this.ctx.store.updateTask(task.id, {
        source_updated_at: issue.updatedAt ?? null,
        last_error: null,
      });
    } catch (err) {
      this.ctx.logger.warn({ task: task.id, err: errorMessage(err) }, 'issue text sync failed');
      await this.ctx.store
        .updateTask(task.id, { last_error: `issue sync failed: ${errorMessage(err)}` })
        .catch(() => {});
    }
  }

  /**
   * Pull remote changes into linked tasks: title/body when the issue changed on
   * the tracker since our watermark, and new human comments (deduplicated by
   * their remote id). Done tasks are left alone. Returns the number of tasks touched.
   */
  async pullUpdates(projectId: string, issues: ExternalIssue[]): Promise<number> {
    const link = await this.deps.integrations().provider(projectId);
    if (!link) return 0;
    const byId = new Map(issues.map((i) => [i.externalId, i]));
    let touched = 0;
    for (const task of await this.ctx.store.listTasks(projectId)) {
      if (!task.source_external_id || task.source_provider !== link.row.provider || task.column === 'done')
        continue;
      const issue = byId.get(task.source_external_id);
      if (!issue?.updatedAt || issue.updatedAt === task.source_updated_at) continue;
      try {
        const patch: Record<string, unknown> = { source_updated_at: issue.updatedAt };
        if (issue.title !== task.title) patch.title = issue.title;
        if (issue.body !== task.description) patch.description = issue.body;
        await this.ctx.store.updateTask(task.id, patch);
        for (const c of await link.provider.listComments(task.source_external_id)) {
          await this.ctx.store.insertTrackerComment({
            task_id: task.id,
            external_id: c.externalId,
            author: c.author,
            body: c.body,
            created_at: c.createdAt,
          });
        }
        touched++;
      } catch (err) {
        this.ctx.logger.warn({ task: task.id, err: errorMessage(err) }, 'issue pull failed');
      }
    }
    return touched;
  }

  /** Push the task's current column to its (freshly linked) issue. */
  async syncNow(task: Task): Promise<void> {
    await this.syncTask({ column: task.column === 'backlog' ? 'todo' : 'backlog' }, task);
  }

  /** Column a freshly imported issue lands in; done/doing/review states are not imported as such. */
  static importColumn(map: Parameters<typeof columnForStatus>[0], status: string | null): Column | 'skip' {
    const mapped = columnForStatus(map, status);
    if (mapped === 'done') return 'skip';
    if (mapped === 'doing' || mapped === 'review') return 'todo';
    return mapped ?? 'backlog';
  }

  /** Projects currently being polled; a second poll of the same project waits for none and returns 0. */
  private readonly polling = new Set<string>();

  /** Import issues matching the integration's filter that are not tasks yet. */
  async pollProject(projectId: string): Promise<number> {
    const link = await this.deps.integrations().provider(projectId);
    if (!link) return 0;
    if (this.polling.has(projectId)) return 0; // start-up poll, ticker and "Fetch now" must not overlap
    this.polling.add(projectId);
    try {
      // soft-deleted tasks still count as imported until they are purged
      const existing = new Set(
        (await this.ctx.store.listTasks(projectId, { includeDeleted: true }))
          .map((t) => t.source_external_id)
          .filter(Boolean),
      );
      const issues = await link.provider.listIssues();
      await this.pullUpdates(projectId, issues);
      const fresh = issues.filter(
        (i) =>
          !existing.has(i.externalId) && IssueService.importColumn(link.row.status_map, i.status) !== 'skip',
      );
      const created = fresh.length
        ? await this.deps.importIssues(
            projectId,
            fresh.map((i) => i.externalId),
          )
        : [];
      await this.ctx.store.updateIntegration(link.row.id, {
        last_polled_at: new Date().toISOString(),
        last_error: null,
      });
      if (created.length)
        this.ctx.logger.info({ project: projectId, imported: created.length }, 'imported issues');
      return created.length;
    } catch (err) {
      await this.ctx.store.updateIntegration(link.row.id, {
        last_polled_at: new Date().toISOString(),
        last_error: errorMessage(err),
      });
      this.ctx.logger.warn({ project: projectId, err: errorMessage(err) }, 'issue import failed');
      return 0;
    } finally {
      this.polling.delete(projectId);
    }
  }

  /** Poll every integration whose interval elapsed (called by a 10 s ticker and on start). */
  async pollDue(now = Date.now()): Promise<number> {
    let total = 0;
    for (const row of await this.ctx.store.listIntegrations()) {
      const last = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
      if (now - last < row.poll_interval_seconds * 1000) continue;
      total += await this.pollProject(row.project_id);
    }
    return total;
  }

  /** Force a poll of every integration (tests, "Fetch now"). */
  async pollAll(): Promise<number> {
    let total = 0;
    for (const row of await this.ctx.store.listIntegrations())
      total += await this.pollProject(row.project_id);
    return total;
  }
}
