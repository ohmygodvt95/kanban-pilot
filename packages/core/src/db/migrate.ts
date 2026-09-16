import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.generated.js';

/**
 * Apply pending drizzle-kit migrations. Migrations are embedded at build time
 * (see scripts/bundle-migrations.ts) so the package needs no file lookup at runtime.
 */
export function runMigrations(sqlite: DatabaseSync): { applied: string[] } {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER)',
  );
  const last = sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number | null } | undefined;
  const lastTs = last?.created_at ?? 0;
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.when <= lastTs) continue;
    sqlite.exec('BEGIN');
    try {
      for (const stmt of m.sql) sqlite.exec(stmt);
      sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(m.hash, m.when);
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
    applied.push(m.tag);
  }
  return { applied };
}
