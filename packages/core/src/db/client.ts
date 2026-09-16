import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { schema } from './schema.js';

export type Database = SqliteRemoteDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /** Raw node:sqlite connection for transactions and migrations. */
  sqlite: DatabaseSync;
  path: string;
  close(): void;
}

function toSqlParam(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Open (or create) the SQLite database. Uses the Node built-in `node:sqlite`
 * through Drizzle's proxy driver so no native build step is required.
 */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  // Loaded lazily so hosts can install a warning filter before Node emits the
  // "SQLite is experimental" warning (which fires when the module is first loaded).
  const { DatabaseSync: Db } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const sqlite: DatabaseSync = new Db(path);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');

  const db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      const bound = params.map(toSqlParam);
      if (method === 'run') {
        stmt.run(...bound);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === 'get') {
        const row = stmt.get(...bound) as unknown[] | undefined;
        // Drizzle expects a single row (array of values) or undefined here.
        return { rows: row as unknown as unknown[] };
      }
      return { rows: stmt.all(...bound) as unknown as unknown[][] };
    },
    { schema },
  );

  return {
    db,
    sqlite,
    path,
    close() {
      sqlite.close();
    },
  };
}
