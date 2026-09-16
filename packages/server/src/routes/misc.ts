import { type Core, CoreError } from '@agent-kanban/core';
import { Hono } from 'hono';

export function commentRoutes(core: Core) {
  const app = new Hono();
  app.delete('/:id', async (c) => {
    await core.tasks.deleteComment(c.req.param('id'));
    return c.body(null, 204);
  });
  return app;
}

export function attemptRoutes(core: Core) {
  const app = new Hono();
  app.get('/:id', async (c) => c.json(await core.store.getAttempt(c.req.param('id'))));
  app.get('/:id/diff', async (c) => {
    const attempt = await core.store.getAttempt(c.req.param('id'));
    return c.json(await core.attempts.diff(attempt));
  });
  app.get('/:id/tests', async (c) => {
    const attempt = await core.store.getAttempt(c.req.param('id'));
    return c.json({ ok: attempt.last_test_ok, output: attempt.last_test_output });
  });
  return app;
}

export function runRoutes(core: Core) {
  const app = new Hono();
  app.get('/:id', async (c) => c.json(await core.store.getRun(c.req.param('id'))));
  app.get('/:id/events', async (c) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isFinite(after) || after < 0)
      throw new CoreError('VALIDATION', 'after must be a non-negative number');
    await core.store.getRun(c.req.param('id'));
    return c.json(await core.store.listRunEvents(c.req.param('id'), after));
  });
  app.post('/:id/cancel', async (c) => {
    await core.tasks.cancelRun(c.req.param('id'));
    return c.json({ ok: true });
  });
  return app;
}
