/**
 * Optional API guard. Two ways to turn it on:
 *
 * - **token** (automatic when the server is bound to a non-loopback address, or `--token`):
 *   every /api request must carry `Authorization: Bearer <token>`, or `?token=` for
 *   EventSource connections which cannot set headers.
 * - **password** (`--password` / AK_PASSWORD): the UI asks for the password once,
 *   `POST /api/auth/login` exchanges it for a random session token that is then used
 *   exactly like a static token. After `maxFailures` wrong passwords in a row the server
 *   calls `onLockout` (the CLI shuts down) — a brute force gets five guesses, not more.
 *
 * `/api/health` and `/api/auth/*` are always reachable so the UI can show the right prompt.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { errorBody } from './errors.js';

export function tokenMatches(expected: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PasswordAuthOptions {
  /** Wrong attempts (in a row, across all clients) before `onLockout` fires. Default 5. */
  maxFailures?: number;
  onLockout?: (failures: number) => void;
}

export type LoginResult = { ok: true; token: string } | { ok: false; remaining: number; locked: boolean };

export class PasswordAuth {
  private readonly sessions = new Set<string>();
  private failures = 0;
  private locked = false;
  readonly maxFailures: number;

  constructor(
    private readonly password: string,
    private readonly opts: PasswordAuthOptions = {},
  ) {
    this.maxFailures = opts.maxFailures ?? 5;
  }

  /** Attempts left before lockout. */
  get remaining(): number {
    return Math.max(0, this.maxFailures - this.failures);
  }

  login(given: string | null | undefined): LoginResult {
    if (this.locked) return { ok: false, remaining: 0, locked: true };
    if (tokenMatches(this.password, given)) {
      this.failures = 0;
      const token = randomBytes(24).toString('base64url');
      this.sessions.add(token);
      return { ok: true, token };
    }
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.locked = true;
      this.opts.onLockout?.(this.failures);
    }
    return { ok: false, remaining: this.remaining, locked: this.locked };
  }

  logout(token: string | null | undefined): void {
    if (token) this.sessions.delete(token);
  }

  accepts(token: string | null | undefined): boolean {
    return !!token && !this.locked && this.sessions.has(token);
  }
}

/** Bearer header first, `?token=` as the EventSource fallback. */
export function givenToken(c: {
  req: { header(name: string): string | undefined; query(name: string): string | undefined };
}) {
  const header = c.req.header('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  return bearer ?? c.req.query('token') ?? null;
}

/** Guards every /api route except health and the login/logout endpoints. */
export function requireAuth(accepts: (token: string | null) => boolean): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (path === '/api/health' || path.startsWith('/api/auth/')) return next();
    if (!accepts(givenToken(c))) {
      return c.json(errorBody('UNAUTHORIZED', 'missing or invalid access token'), 401);
    }
    return next();
  };
}

/** Static-token variant kept for callers that only have a token. */
export function requireToken(token: string): MiddlewareHandler {
  return requireAuth((given) => tokenMatches(token, given));
}
