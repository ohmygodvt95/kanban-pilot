import type { Core } from '@agent-kanban/core';
import {
  answerQuestionSchema,
  chatMessageSchema,
  createCommentSchema,
  transitionRequestSchema,
  updateTaskSchema,
} from '@agent-kanban/shared';
import { Hono } from 'hono';
import { zValidator } from '../validate.js';

export function taskRoutes(core: Core) {
  const app = new Hono();

  app.get('/:id', async (c) => c.json(await core.tasks.detail(c.req.param('id'))));

  app.patch('/:id', zValidator('json', updateTaskSchema), async (c) => {
    return c.json(await core.tasks.update(c.req.param('id'), c.req.valid('json')));
  });

  app.delete('/:id', async (c) => {
    await core.tasks.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  /** The only way to change a task's column. Invalid transitions → 409. */
  app.post('/:id/transition', zValidator('json', transitionRequestSchema), async (c) => {
    const { target, payload } = c.req.valid('json');
    const task = await core.tasks.transition(c.req.param('id'), target, 'user', payload ?? {});
    return c.json(task);
  });

  /** Free-form instruction to the agent (see TaskService.chat). */
  app.post('/:id/chat', zValidator('json', chatMessageSchema), async (c) => {
    return c.json(await core.tasks.chat(c.req.param('id'), c.req.valid('json').message));
  });

  app.post('/:id/clone', async (c) => c.json(await core.tasks.clone(c.req.param('id')), 201));

  app.post('/:id/comments', zValidator('json', createCommentSchema), async (c) => {
    return c.json(await core.tasks.addComment(c.req.param('id'), c.req.valid('json')), 201);
  });

  app.post('/:id/questions/:qid/answer', zValidator('json', answerQuestionSchema), async (c) => {
    return c.json(
      await core.refinement.answer(c.req.param('id'), c.req.param('qid'), c.req.valid('json').answer),
    );
  });

  app.post('/:id/attempts/restart', async (c) => c.json(await core.tasks.restartAttempt(c.req.param('id'))));
  app.post('/:id/attempts/discard', async (c) => c.json(await core.tasks.discardAttempt(c.req.param('id'))));

  return app;
}
