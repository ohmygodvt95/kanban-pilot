import type { Core, Logger } from '@agent-kanban/core';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { requireToken } from './auth.js';
import { errorBody, handleError } from './errors.js';
import { attachmentRoutes, attemptRoutes, commentRoutes, runRoutes } from './routes/misc.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { sseRoutes } from './sse.js';
import { mountStatic } from './static.js';
import { UpdateCheck } from './update-check.js';

export interface AppOptions {
  core: Core;
  logger?: Logger;
  /** Directory of the built web app; when omitted only /api is served. */
  webDistDir?: string;
  requestLogging?: boolean;
  /** Running version, reported by /api/health and compared with npm. */
  version?: string;
  /** When set, every /api route (except health) requires this bearer token. */
  token?: string;
  /** Disable the daily npm version lookup (tests, air-gapped setups). */
  updateCheck?: boolean;
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();
  if (opts.requestLogging)
    app.use(
      '*',
      honoLogger((msg) => opts.logger?.info(msg)),
    );
  app.onError(handleError);
  app.notFound((c) => c.json(errorBody('NOT_FOUND', `no route for ${c.req.method} ${c.req.path}`), 404));

  const api = new Hono();
  if (opts.token) api.use('*', requireToken(opts.token));
  const version = opts.version ?? 'dev';
  const updates = opts.updateCheck === false ? null : new UpdateCheck(version);
  api.get('/health', (c) =>
    c.json({
      ok: true,
      pid: process.pid,
      activeRuns: opts.core.runner.activeRunIds,
      version,
      latest_version: updates?.latest() ?? null,
      auth_required: !!opts.token,
    }),
  );
  /** Whole-database backup (JSON); `?events=0` leaves the run event streams out. */
  api.get('/backup', async (c) => {
    const doc = await opts.core.backup.export({ events: c.req.query('events') !== '0' });
    c.header(
      'content-disposition',
      `attachment; filename="agent-kanban-${doc.exported_at.slice(0, 10)}.json"`,
    );
    return c.json(doc);
  });
  api.post('/backup', async (c) => c.json(await opts.core.backup.import(await c.req.json())));
  /** Tracker modules and their configuration fields (drives the integration form). */
  api.get('/providers', (c) => c.json(opts.core.integrations.modules()));
  api.route('/projects', projectRoutes(opts.core));
  api.route('/tasks', taskRoutes(opts.core));
  api.route('/comments', commentRoutes(opts.core));
  api.route('/attempts', attemptRoutes(opts.core));
  api.route('/attachments', attachmentRoutes(opts.core));
  api.route('/runs', runRoutes(opts.core));
  api.route('/events', sseRoutes(opts.core));
  app.route('/api', api);

  if (opts.webDistDir) mountStatic(app, opts.webDistDir);
  return app;
}
