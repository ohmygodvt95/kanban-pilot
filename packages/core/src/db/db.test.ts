import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { projects, tasks } from './schema.js';

describe('database', () => {
  it('runs migrations on an empty db and supports basic CRUD', async () => {
    const h = openDatabase(':memory:');
    const { applied } = runMigrations(h.sqlite);
    expect(applied.length).toBeGreaterThan(0);
    // idempotent
    expect(runMigrations(h.sqlite).applied).toEqual([]);

    const now = new Date().toISOString();
    await h.db.insert(projects).values({
      id: 'p1',
      name: 'demo',
      repo_path: '/tmp/demo',
      created_at: now,
      updated_at: now,
    });
    await h.db.insert(tasks).values({
      id: 't1',
      project_id: 'p1',
      title: 'hello',
      position: 1.5,
      created_at: now,
      updated_at: now,
    });
    const t = await h.db.query.tasks.findFirst({ where: eq(tasks.id, 't1') });
    expect(t?.title).toBe('hello');
    expect(t?.column).toBe('backlog');
    expect(t?.skip_refinement).toBe(false);
    const missing = await h.db.query.tasks.findFirst({ where: eq(tasks.id, 'nope') });
    expect(missing).toBeUndefined();
    const p = await h.db.select().from(projects);
    expect(p[0]?.auto_done).toBe(false);
    expect(p[0]?.refinement_enabled).toBe(true);

    await h.db
      .update(tasks)
      .set({ column: 'todo', substate: 'ready', skip_refinement: true })
      .where(eq(tasks.id, 't1'));
    const t2 = await h.db.query.tasks.findFirst({ where: eq(tasks.id, 't1') });
    expect(t2?.column).toBe('todo');
    expect(t2?.skip_refinement).toBe(true);
    // cascade
    await h.db.delete(projects).where(eq(projects.id, 'p1'));
    expect(await h.db.select().from(tasks)).toEqual([]);
    h.close();
  });
});
