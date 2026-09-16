/**
 * Housekeeping that is not tied to one task: cost reports, disk footprint of a
 * project (worktrees + agent logs) and reclaiming what finished work left behind.
 */
import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiskUsage, ProjectCosts } from '@agent-kanban/shared';
import type { CoreContext } from './context.js';
import { pruneWorktrees } from './git/git.js';
import { errorMessage } from './util/errors.js';

/** Recursive size of a path in bytes (0 when missing). */
export async function dirSize(path: string): Promise<number> {
  try {
    const st = await stat(path);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      total += entry.isDirectory()
        ? await dirSize(child)
        : ((await stat(child).catch(() => null))?.size ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}

export class MaintenanceService {
  constructor(private readonly ctx: CoreContext) {}

  costs(projectId: string, days = 14): Promise<ProjectCosts> {
    return this.ctx.store.projectCosts(projectId, days);
  }

  /** Worktree dirs of the project that no active attempt owns, and log dirs of runs of DONE tasks. */
  private async reclaimable(projectId: string) {
    const active = new Set(
      (await this.ctx.store.listActiveAttempts())
        .filter((a) => a.worktree_path.startsWith(join(this.ctx.paths.worktreesRoot, projectId)))
        .map((a) => a.worktree_path),
    );
    const root = join(this.ctx.paths.worktreesRoot, projectId);
    const worktrees: string[] = [];
    if (existsSync(root))
      for (const name of await readdir(root)) {
        const path = join(root, name);
        if (!active.has(path)) worktrees.push(path);
      }
    const tasks = new Map(
      (await this.ctx.store.listTasks(projectId, { includeDeleted: true })).map((t) => [t.id, t]),
    );
    const logs: string[] = [];
    for (const run of await this.ctx.store.listProjectRuns(projectId)) {
      const task = tasks.get(run.task_id);
      const finished = run.status !== 'queued' && run.status !== 'running';
      if (run.log_dir && finished && (task?.column === 'done' || task?.deleted_at) && existsSync(run.log_dir))
        logs.push(run.log_dir);
    }
    return { root, worktrees, logs };
  }

  async disk(projectId: string): Promise<DiskUsage> {
    await this.ctx.store.getProject(projectId);
    const { root, worktrees, logs } = await this.reclaimable(projectId);
    let logsBytes = 0;
    for (const run of await this.ctx.store.listProjectRuns(projectId))
      if (run.log_dir) logsBytes += await dirSize(run.log_dir);
    let reclaimable = 0;
    for (const p of [...worktrees, ...logs]) reclaimable += await dirSize(p);
    return {
      worktrees_bytes: await dirSize(root),
      logs_bytes: logsBytes,
      reclaimable_bytes: reclaimable,
      reclaimable_items: worktrees.length + logs.length,
    };
  }

  /** Delete reclaimable worktrees and logs; returns freed bytes. Run events in the DB are kept. */
  async clean(projectId: string): Promise<{ freed_bytes: number; removed: number }> {
    const project = await this.ctx.store.getProject(projectId);
    const { worktrees, logs } = await this.reclaimable(projectId);
    let freed = 0;
    let removed = 0;
    for (const p of [...worktrees, ...logs]) {
      const size = await dirSize(p);
      try {
        await rm(p, { recursive: true, force: true });
        freed += size;
        removed++;
      } catch (err) {
        this.ctx.logger.warn({ path: p, err: errorMessage(err) }, 'cleanup: cannot remove');
      }
    }
    if (worktrees.length) await pruneWorktrees(project.repo_path).catch(() => {});
    return { freed_bytes: freed, removed };
  }
}
