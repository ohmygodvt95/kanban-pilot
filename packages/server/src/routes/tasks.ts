import type { Core, UploadedFile } from '@agent-kanban/core';
import {
  answerQuestionSchema,
  chatMessageSchema,
  createCommentSchema,
  transitionRequestSchema,
  updateTaskSchema,
} from '@agent-kanban/shared';
import { Hono } from 'hono';
import { errorBody } from '../errors.js';
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

  /**
   * Free-form instruction to the agent (see TaskService.chat). Accepts JSON
   * `{ message }` or multipart form data with a `message` field and one or more
   * `files` (png/jpeg/gif/webp, ≤10 MB each) that the agent can look at.
   */
  app.post('/:id/chat', async (c) => {
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody({ all: true });
      const message = typeof body.message === 'string' ? body.message : '';
      const raw = body.files ?? body['files[]'];
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
      const files: UploadedFile[] = await Promise.all(
        list.map(async (f) => ({ name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      return c.json(await core.tasks.chat(c.req.param('id'), message, files));
    }
    const parsed = chatMessageSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json(errorBody('VALIDATION', 'invalid request', parsed.error.issues), 400);
    return c.json(await core.tasks.chat(c.req.param('id'), parsed.data.message));
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
  /** Merge the base branch into the attempt; conflicts are handed to the agent. */
  app.post('/:id/attempts/update-base', async (c) =>
    c.json(await core.tasks.updateFromBase(c.req.param('id'))),
  );
  /** Re-run the project's test script on the current attempt (async job). */
  app.post('/:id/tests/run', async (c) => {
    await core.tasks.runTests(c.req.param('id'));
    return c.json({ ok: true });
  });

  return app;
}
