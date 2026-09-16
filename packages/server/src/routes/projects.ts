import type { Core } from '@agent-kanban/core';
import {
  bulkPushSchema,
  createProjectSchema,
  createTaskSchema,
  importIssuesSchema,
  integrationInputSchema,
  restoreTasksSchema,
  updateProjectSchema,
} from '@agent-kanban/shared';
import { Hono } from 'hono';
import { zValidator } from '../validate.js';

export function projectRoutes(core: Core) {
  const app = new Hono();

  app.get('/', async (c) => c.json(await core.projects.list()));

  app.post('/', zValidator('json', createProjectSchema), async (c) => {
    const project = await core.projects.create(c.req.valid('json'));
    return c.json(project, 201);
  });

  app.get('/:id', async (c) => c.json(await core.projects.get(c.req.param('id'))));

  app.patch('/:id', zValidator('json', updateProjectSchema), async (c) => {
    return c.json(await core.projects.update(c.req.param('id'), c.req.valid('json')));
  });

  app.delete('/:id', async (c) => {
    await core.projects.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  app.get('/:id/executors', async (c) => {
    await core.projects.get(c.req.param('id'));
    return c.json(await core.projects.executorStatus());
  });

  /** The configured tracker and whether its credentials work (null when none is configured). */
  app.get('/:id/provider', async (c) => c.json(await core.projects.providerStatus(c.req.param('id'))));

  // ---- integration (one tracker per project) ------------------------------
  /** Masked integration (secrets replaced by flags) or null. */
  app.get('/:id/integration', async (c) => c.json(await core.integrations.get(c.req.param('id'))));
  /** Prefill for a new integration derived from the origin remote. */
  app.get('/:id/integration/suggest', async (c) =>
    c.json(await core.integrations.suggest(c.req.param('id'))),
  );
  app.put('/:id/integration', zValidator('json', integrationInputSchema), async (c) => {
    return c.json(await core.integrations.upsert(c.req.param('id'), c.req.valid('json')));
  });
  app.delete('/:id/integration', async (c) => {
    await core.integrations.remove(c.req.param('id'));
    return c.body(null, 204);
  });
  /** Verify credentials for the given (possibly unsaved) settings. */
  app.post('/:id/integration/test', zValidator('json', integrationInputSchema), async (c) => {
    return c.json(await core.integrations.test(c.req.param('id'), c.req.valid('json')));
  });
  /** Remote statuses / labels for the status-map editor. */
  app.get('/:id/integration/statuses', async (c) =>
    c.json(await core.integrations.statuses(c.req.param('id'))),
  );
  /** Issue types + fields the tracker needs to create an issue (drives push defaults and the push form). */
  app.get('/:id/integration/create-meta', async (c) =>
    c.json(await core.integrations.createMeta(c.req.param('id'))),
  );
  /** Tracker users for user-picker fields of the push form. */
  app.get('/:id/integration/users', async (c) =>
    c.json(await core.integrations.searchUsers(c.req.param('id'), c.req.query('q') ?? '')),
  );
  /** Spend per day + today/week/total. */
  app.get('/:id/costs', async (c) =>
    c.json(await core.maintenance.costs(c.req.param('id'), Number(c.req.query('days') ?? 14))),
  );
  /** Disk footprint (worktrees + agent logs) and what a cleanup would reclaim. */
  app.get('/:id/disk', async (c) => c.json(await core.maintenance.disk(c.req.param('id'))));
  app.post('/:id/disk/clean', async (c) => c.json(await core.maintenance.clean(c.req.param('id'))));
  /** Import new issues right now. */
  app.post('/:id/integration/fetch', async (c) =>
    c.json({ imported: await core.issues.pollProject(c.req.param('id')) }),
  );

  app.get('/:id/issues', async (c) => {
    return c.json(
      await core.projects.listIssues(c.req.param('id'), { query: c.req.query('query') ?? undefined }),
    );
  });

  app.post('/:id/import-issues', zValidator('json', importIssuesSchema), async (c) => {
    return c.json(await core.projects.importIssues(c.req.param('id'), c.req.valid('json').external_ids), 201);
  });

  app.get('/:id/tasks', async (c) => {
    await core.projects.get(c.req.param('id'));
    return c.json(await core.store.listTasks(c.req.param('id')));
  });

  /** Bulk delete every task of the project; `?force=1` also cancels running agents. */
  app.delete('/:id/tasks', async (c) => {
    const force = ['1', 'true'].includes(c.req.query('force') ?? '');
    return c.json(await core.tasks.deleteAll(c.req.param('id'), { force }));
  });
  /** Undo a bulk clear (ids come from the DELETE response). */
  app.post('/:id/tasks/restore', zValidator('json', restoreTasksSchema), async (c) =>
    c.json(await core.tasks.restore(c.req.param('id'), c.req.valid('json').ids)),
  );
  /** Push several unlinked tasks to the tracker with shared field values (409 CONFIRM_REQUIRED lists missing fields). */
  app.post('/:id/tasks/push', zValidator('json', bulkPushSchema), async (c) => {
    const input = c.req.valid('json');
    return c.json(
      await core.tasks.pushMany(c.req.param('id'), input.ids, {
        issueTypeId: input.issue_type_id ?? null,
        fields: input.fields,
      }),
    );
  });

  app.post('/:id/tasks', zValidator('json', createTaskSchema), async (c) => {
    const task = await core.tasks.create(c.req.param('id'), c.req.valid('json'));
    return c.json(task, 201);
  });

  return app;
}
