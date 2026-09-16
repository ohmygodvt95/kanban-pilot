import type { Core } from '@agent-kanban/core';
import {
  createProjectSchema,
  createTaskSchema,
  importIssuesSchema,
  integrationInputSchema,
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

  app.post('/:id/tasks', zValidator('json', createTaskSchema), async (c) => {
    const task = await core.tasks.create(c.req.param('id'), c.req.valid('json'));
    return c.json(task, 201);
  });

  return app;
}
