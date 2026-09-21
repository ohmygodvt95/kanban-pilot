import { describe, expect, it } from 'vitest';
import { PasswordAuth } from './auth.js';

describe('password auth', () => {
  it('exchanges the password for a session token and forgets it on logout', () => {
    const auth = new PasswordAuth('hunter2');
    expect(auth.accepts('anything')).toBe(false);
    const res = auth.login('hunter2');
    expect(res.ok).toBe(true);
    const token = res.ok ? res.token : '';
    expect(token.length).toBeGreaterThan(20);
    expect(auth.accepts(token)).toBe(true);
    auth.logout(token);
    expect(auth.accepts(token)).toBe(false);
  });

  it('locks after the configured number of wrong passwords in a row', () => {
    const lockouts: number[] = [];
    const auth = new PasswordAuth('hunter2', { maxFailures: 3, onLockout: (n) => lockouts.push(n) });
    expect(auth.login('a')).toEqual({ ok: false, remaining: 2, locked: false });
    // a correct password resets the counter
    const good = auth.login('hunter2');
    expect(good.ok).toBe(true);
    expect(auth.remaining).toBe(3);
    expect(auth.login('b')).toEqual({ ok: false, remaining: 2, locked: false });
    expect(auth.login('c')).toEqual({ ok: false, remaining: 1, locked: false });
    expect(auth.login('d')).toEqual({ ok: false, remaining: 0, locked: true });
    expect(lockouts).toEqual([3]);
    // once locked nothing gets through, not even the right password or an existing session
    expect(auth.login('hunter2')).toEqual({ ok: false, remaining: 0, locked: true });
    expect(auth.accepts(good.ok ? good.token : '')).toBe(false);
    expect(lockouts).toEqual([3]);
  });
});
