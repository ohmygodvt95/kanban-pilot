/**
 * Issue tracker glue: resolves the provider of a project, mirrors task
 * milestones onto linked issues (best-effort, never blocks a transition) and
 * imports issues carrying the configured labels on a timer.
 */
import type { Project, Task } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import { remoteUrl } from './git/git.js';
import { type DetectedProvider, detectProvider, type IssueStatus } from './providers/index.js';
import { errorMessage } from './util/errors.js';

export interface IssueSyncDeps {
  /** Creates backlog tasks from external ids; provided by ProjectService. */
  importIssues(projectId: string, externalIds: string[]): Promise<Task[]>;
}

export class IssueService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: IssueSyncDeps,
  ) {}

  /** Provider for a project: manual link first, else the origin remote. */
  async detect(project: Project): Promise<DetectedProvider | null> {
    return detectProvider(this.ctx.providers, await remoteUrl(project.repo_path), {
      provider: project.issue_provider,
      projectRef: project.issue_project_ref,
    });
  }

  /** Milestone reached by a task (called by TaskService after a column change). */
  statusFor(prev: Pick<Task, 'column'>, next: Pick<Task, 'column'>): IssueStatus | null {
    if (prev.column === next.column) return null;
    if (next.column === 'doing' && prev.column === 'todo') return 'in_progress';
    if (next.column === 'review' && prev.column === 'doing') return 'in_review';
    if (next.column === 'done') return 'done';
    return null;
  }

  /**
   * Post the milestone on the linked issue. Errors are logged and stored on the
   * task's `last_error` so the user notices, but the transition itself is never rolled back.
   */
  async syncTask(task: Task, status: IssueStatus): Promise<void> {
    if (!task.source_external_id || !task.source_provider) return;
    const project = await this.ctx.store.getProject(task.project_id);
    if (!project.issue_sync) return;
    const detected = await this.detect(project);
    if (!detected || detected.provider.id !== task.source_provider) return;
    const attempt = task.current_attempt_id
      ? await this.ctx.store.findAttempt(task.current_attempt_id)
      : null;
    try {
      await detected.provider.syncStatus(task.source_external_id, status, {
        branch: attempt?.branch ?? null,
        prUrl: attempt?.pr_url ?? null,
        taskTitle: task.title,
      });
      this.ctx.logger.info({ task: task.id, issue: task.source_external_id, status }, 'issue status synced');
    } catch (err) {
      this.ctx.logger.warn({ task: task.id, err: errorMessage(err) }, 'issue sync failed');
      await this.ctx.store
        .updateTask(task.id, { last_error: `issue sync failed: ${errorMessage(err)}` })
        .catch(() => {});
    }
  }

  /** Import open issues with the project's `issue_import_labels` that are not tasks yet. */
  async pollProject(project: Project): Promise<number> {
    const labels = (project.issue_import_labels ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    if (labels.length === 0) return 0;
    const detected = await this.detect(project);
    if (!detected || !(await detected.provider.check()).ok) return 0;
    const existing = new Set(
      (await this.ctx.store.listTasks(project.id)).map((t) => t.source_external_id).filter(Boolean),
    );
    const issues = await detected.provider.listIssues(detected.projectRef, { labels });
    const fresh = issues.filter((i) => !existing.has(i.externalId)).map((i) => i.externalId);
    if (fresh.length === 0) return 0;
    const created = await this.deps.importIssues(project.id, fresh);
    this.ctx.logger.info({ project: project.id, imported: created.length, labels }, 'imported issues');
    return created.length;
  }

  /** One pass over all projects (timer + start). */
  async pollAll(): Promise<number> {
    let total = 0;
    for (const project of await this.ctx.store.listProjects()) {
      try {
        total += await this.pollProject(project);
      } catch (err) {
        this.ctx.logger.warn({ project: project.id, err: errorMessage(err) }, 'issue import failed');
      }
    }
    return total;
  }
}
