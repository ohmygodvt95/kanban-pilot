import type { Core } from '@agent-kanban/core';
import {
  createProjectSchema,
  createTaskSchema,
  importIssuesSchema,
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

  /** Issue provider detected from the origin remote (GitHub) and its credential status. */
  app.get('/:id/provider', async (c) => c.json(await core.projects.providerStatus(c.req.param('id'))));

  app.get('/:id/issues', async (c) => {
    const labels = c.req.query('labels');
    return c.json(
      await core.projects.listIssues(c.req.param('id'), {
        query: c.req.query('query') ?? undefined,
        labels: labels ? labels.split(',').filter(Boolean) : undefined,
      }),
    );
  });

  app.post('/:id/import-issues', zValidator('json', importIssuesSchema), async (c) => {
    return c.json(await core.projects.importIssues(c.req.param('id'), c.req.valid('json').external_ids), 201);
  });

  app.get('/:id/tasks', async (c) => {
    await core.projects.get(c.req.param('id'));
    return c.json(await core.store.listTasks(c.req.param('id')));
  });

  app.post('/:id/tasks', zValidator('json', createTaskSchema), async (c) => {
    const task = await core.tasks.create(c.req.param('id'), c.req.valid('json'));
    return c.json(task, 201);
  });

  return app;
}
