/**
 * Whole-database export/import as one JSON document, for moving agent-kanban to
 * another machine. Attachment files and worktrees are not included; integration
 * secrets ARE included (the backup is meant to stay local).
 */
import type { CoreContext } from './context.js';
import { CoreError } from './util/errors.js';

export const BACKUP_FORMAT = 1;

export interface BackupDocument {
  format: number;
  app: 'agent-kanban';
  exported_at: string;
  tables: Record<string, unknown[]>;
}

export class BackupService {
  constructor(private readonly ctx: CoreContext) {}

  async export(opts: { events?: boolean } = {}): Promise<BackupDocument> {
    return {
      format: BACKUP_FORMAT,
      app: 'agent-kanban',
      exported_at: new Date().toISOString(),
      tables: await this.ctx.store.dumpAll(opts),
    };
  }

  /** Merge a backup into this database; existing rows (same id) are kept untouched. */
  async import(doc: unknown): Promise<Record<string, number>> {
    const d = doc as Partial<BackupDocument> | null;
    if (!d || d.app !== 'agent-kanban' || !d.tables || typeof d.tables !== 'object')
      throw new CoreError('VALIDATION', 'not an agent-kanban backup file');
    if ((d.format ?? 0) > BACKUP_FORMAT)
      throw new CoreError('VALIDATION', `backup format ${d.format} is newer than this version understands`);
    return this.ctx.store.importDump(d.tables);
  }
}
