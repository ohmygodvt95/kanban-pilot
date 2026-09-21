import type { Core, Logger } from '@agent-kanban/core';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { givenToken, PasswordAuth, requireAuth, tokenMatches } from './auth.js';
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
  /** npm package name (default kanban-pilot): update lookup target and install hint for the UI. */
  packageName?: string;
  /** When set, every /api route (except health) requires this bearer token. */
  token?: string;
  /** When set, the UI must log in with this password (POST /api/auth/login → session token). */
  password?: string;
  /** Wrong passwords in a row before `onLockout` (default 5). */
  maxLoginFailures?: number;
  /** Called once when the wrong-password limit is hit; the CLI shuts the server down. */
  onLockout?: (failures: number) => void;
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
  const passwordAuth = opts.password
    ? new PasswordAuth(opts.password, { maxFailures: opts.maxLoginFailures, onLockout: opts.onLockout })
    : null;
  if (opts.token || passwordAuth) {
    api.use(
      '*',
      requireAuth(
        (given) =>
          (!!opts.token && tokenMatches(opts.token, given)) || (passwordAuth?.accepts(given) ?? false),
      ),
    );
  }
  if (passwordAuth) {
    api.post('/auth/login', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
      const res = passwordAuth.login(typeof body.password === 'string' ? body.password : null);
      if (res.ok) return c.json({ token: res.token });
      opts.logger?.warn(
        res.locked
          ? `wrong password: limit of ${passwordAuth.maxFailures} reached, locking`
          : `wrong password (${res.remaining} attempt(s) left)`,
      );
      return c.json(
        errorBody('UNAUTHORIZED', res.locked ? 'too many wrong passwords' : 'wrong password', {
          remaining: res.remaining,
          locked: res.locked,
        }),
        401,
      );
    });
    api.post('/auth/logout', (c) => {
      passwordAuth.logout(givenToken(c));
      return c.body(null, 204);
    });
  }
  const version = opts.version ?? 'dev';
  const packageName = opts.packageName ?? 'kanban-pilot';
  const updates = opts.updateCheck === false ? null : new UpdateCheck(version, packageName);
  api.get('/health', (c) =>
    c.json({
      ok: true,
      pid: process.pid,
      activeRuns: opts.core.runner.activeRunIds,
      version,
      package_name: packageName,
      latest_version: updates?.latest() ?? null,
      auth_required: !!opts.token || !!passwordAuth,
      auth_mode: passwordAuth ? 'password' : opts.token ? 'token' : null,
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
