/**
 * Optional bearer-token guard for the API. Enabled when the server is bound to a
 * non-loopback address (or a token is configured explicitly): every /api request
 * except /api/health must carry `Authorization: Bearer <token>`, or `?token=`
 * for EventSource connections which cannot set headers.
 */
import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { errorBody } from './errors.js';

export function tokenMatches(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireToken(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === '/api/health') return next();
    const header = c.req.header('authorization');
    const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
    const given = bearer ?? c.req.query('token');
    if (!tokenMatches(token, given)) {
      return c.json(errorBody('UNAUTHORIZED', 'missing or invalid access token'), 401);
    }
    return next();
  };
}
