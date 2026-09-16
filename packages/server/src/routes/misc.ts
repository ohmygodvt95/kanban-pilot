import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { type Core, CoreError } from '@agent-kanban/core';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Stream a local file with the given mime type. */
function sendFile(c: Parameters<typeof stream>[0], path: string, mime: string, name?: string) {
  const size = statSync(path).size;
  c.header('Content-Type', mime);
  c.header('Content-Length', String(size));
  c.header('Cache-Control', 'private, max-age=3600');
  if (name) c.header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
  return stream(c, async (s) => {
    for await (const chunk of createReadStream(path)) s.write(chunk as Uint8Array);
  });
}

export function commentRoutes(core: Core) {
  const app = new Hono();
  app.delete('/:id', async (c) => {
    await core.tasks.deleteComment(c.req.param('id'));
    return c.body(null, 204);
  });
  return app;
}

/** GET /attachments/:id — bytes of an image attached to a chat message. */
export function attachmentRoutes(core: Core) {
  const app = new Hono();
  app.get('/:id', async (c) => {
    const att = await core.store.findAttachment(c.req.param('id'));
    if (!att) throw new CoreError('NOT_FOUND', `attachment ${c.req.param('id')} not found`);
    const path = core.tasks.attachmentPath(att);
    if (!existsSync(path)) throw new CoreError('NOT_FOUND', 'attachment file is missing on disk');
    return sendFile(c, path, att.mime, att.name);
  });
  return app;
}

export function attemptRoutes(core: Core) {
  const app = new Hono();
  app.get('/:id', async (c) => c.json(await core.store.getAttempt(c.req.param('id'))));
  /**
   * GET /attempts/:id/file?path=<relative> — an image produced by the agent inside
   * the worktree (screenshots, diagrams) so the Chat/Activity tabs can display it.
   * Only image types are served and the path must stay inside the worktree.
   */
  app.get('/:id/file', async (c) => {
    const attempt = await core.store.getAttempt(c.req.param('id'));
    if (attempt.status !== 'active')
      throw new CoreError('CONFLICT', 'the worktree of this attempt no longer exists');
    const rel = c.req.query('path') ?? '';
    const root = resolve(attempt.worktree_path);
    const full = resolve(root, rel);
    if (!rel || !(full === root || full.startsWith(root + sep)))
      throw new CoreError('VALIDATION', 'path must be inside the worktree');
    const mime = IMAGE_MIME[extname(full).toLowerCase()];
    if (!mime) throw new CoreError('VALIDATION', 'only image files can be served');
    if (!existsSync(full) || !statSync(full).isFile())
      throw new CoreError('NOT_FOUND', `${rel} not found in the worktree`);
    return sendFile(c, full, mime);
  });
  app.get('/:id/diff', async (c) => {
    const attempt = await core.store.getAttempt(c.req.param('id'));
    const task = await core.store.getTask(attempt.task_id);
    const project = await core.store.getProject(task.project_id);
    return c.json(await core.attempts.diff(attempt, project));
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
