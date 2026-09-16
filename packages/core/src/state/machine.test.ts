import type { Column, Substate } from '@agent-kanban/shared';
import { describe, expect, it } from 'vitest';
import { CoreError } from '../util/errors.js';
import { decide, type TransitionContext } from './machine.js';

function ctx(
  column: Column,
  substate: Substate | null,
  over: Partial<Omit<TransitionContext, 'task'>> & {
    skip_refinement?: boolean;
    refinement_enabled?: boolean;
    auto_done?: boolean;
  } = {},
): TransitionContext {
  return {
    task: { column, substate, skip_refinement: over.skip_refinement ?? false },
    project: { refinement_enabled: over.refinement_enabled ?? true, auto_done: over.auto_done ?? false },
    hasActiveRun: over.hasActiveRun ?? false,
    unconsumedFeedback: over.unconsumedFeedback ?? 0,
    activeAttempt: over.activeAttempt ?? null,
  };
}

const expectInvalid = (fn: () => unknown, code = 'INVALID_TRANSITION', match?: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CoreError);
    expect((e as CoreError).code).toBe(code);
    if (match) expect((e as CoreError).message).toMatch(match);
    return;
  }
  throw new Error('expected transition to be rejected');
};

describe('state machine: BACKLOG', () => {
  it('user drag to TODO starts refinement when enabled', () => {
    expect(decide(ctx('backlog', 'draft'), 'todo', 'user')).toEqual({ kind: 'start_refine' });
  });
  it('user drag to TODO moves directly when refinement disabled or skipped', () => {
    expect(decide(ctx('backlog', 'draft', { refinement_enabled: false }), 'todo', 'user')).toEqual({
      kind: 'set',
      column: 'todo',
      substate: 'ready',
    });
    expect(decide(ctx('backlog', 'draft', { skip_refinement: true }), 'todo', 'user')).toEqual({
      kind: 'set',
      column: 'todo',
      substate: 'ready',
    });
  });
  it('rejects drag while refining or with open questions', () => {
    expectInvalid(
      () => decide(ctx('backlog', 'refining', { hasActiveRun: true }), 'todo', 'user'),
      undefined,
      /already running/,
    );
    expectInvalid(() => decide(ctx('backlog', 'needs_answer'), 'todo', 'user'), undefined, /answer the open/);
    // skip refinement unlocks it
    expect(decide(ctx('backlog', 'needs_answer', { skip_refinement: true }), 'todo', 'user').kind).toBe(
      'set',
    );
  });
  it('system substate moves inside backlog', () => {
    expect(decide(ctx('backlog', 'refining'), 'backlog', 'system', { substate: 'needs_answer' })).toEqual({
      kind: 'set',
      column: 'backlog',
      substate: 'needs_answer',
    });
    expect(decide(ctx('backlog', 'needs_answer'), 'backlog', 'system', { substate: 'refining' }).kind).toBe(
      'set',
    );
    expectInvalid(() => decide(ctx('backlog', 'refining'), 'backlog', 'system', { substate: 'ready' }));
    expectInvalid(() => decide(ctx('backlog', 'refining'), 'backlog', 'system'));
  });
  it('system finishes refinement → TODO(ready)', () => {
    expect(decide(ctx('backlog', 'refining'), 'todo', 'system', { plan: 'p' })).toEqual({
      kind: 'set',
      column: 'todo',
      substate: 'ready',
    });
  });
  it('rejects BACKLOG → DOING/REVIEW/DONE', () => {
    for (const t of ['doing', 'review', 'done'] as const)
      expectInvalid(() => decide(ctx('backlog', 'draft'), t, 'user'));
  });
  it('user reorder inside backlog is a noop', () => {
    expect(decide(ctx('backlog', 'draft'), 'backlog', 'user', { position: 3 })).toEqual({ kind: 'noop' });
  });
});

describe('state machine: TODO', () => {
  it('user starts the task', () => {
    expect(decide(ctx('todo', 'ready'), 'doing', 'user')).toEqual({ kind: 'start_attempt' });
  });
  it('rejects start when a run/attempt is active', () => {
    expectInvalid(() => decide(ctx('todo', 'ready', { hasActiveRun: true }), 'doing', 'user'));
    expectInvalid(() => decide(ctx('todo', 'ready', { activeAttempt: { id: 'a' } }), 'doing', 'user'));
  });
  it('system cannot start a task', () => {
    expectInvalid(() => decide(ctx('todo', 'ready'), 'doing', 'system'));
  });
  it('moves back to backlog as draft', () => {
    expect(decide(ctx('todo', 'ready'), 'backlog', 'user')).toEqual({
      kind: 'set',
      column: 'backlog',
      substate: 'draft',
    });
  });
  it('rejects TODO → REVIEW/DONE', () => {
    expectInvalid(() => decide(ctx('todo', 'ready'), 'review', 'user'));
    expectInvalid(() => decide(ctx('todo', 'ready'), 'done', 'user'));
  });
});

describe('state machine: DOING', () => {
  const attempt = { id: 'a1' };
  it('runner moves queued → running, running → error', () => {
    expect(
      decide(ctx('doing', 'queued', { activeAttempt: attempt }), 'doing', 'system', { substate: 'running' })
        .kind,
    ).toBe('set');
    expect(
      decide(ctx('doing', 'running', { activeAttempt: attempt }), 'doing', 'system', { substate: 'error' })
        .kind,
    ).toBe('set');
    expect(
      decide(ctx('doing', 'queued', { activeAttempt: attempt }), 'doing', 'system', { substate: 'error' })
        .kind,
    ).toBe('set');
    // running → queued is used when a run is replaced by a fallback run (session lost)
    expect(decide(ctx('doing', 'running'), 'doing', 'system', { substate: 'queued' }).kind).toBe('set');
    expectInvalid(() => decide(ctx('doing', 'queued'), 'doing', 'system', { substate: 'waiting_feedback' }));
    expectInvalid(() => decide(ctx('doing', 'running'), 'doing', 'system', { substate: 'pending' }));
  });
  it('system moves to REVIEW with pending/tests_failed', () => {
    expect(decide(ctx('doing', 'running', { activeAttempt: attempt }), 'review', 'system')).toEqual({
      kind: 'set',
      column: 'review',
      substate: 'pending',
    });
    expect(
      decide(ctx('doing', 'running', { activeAttempt: attempt }), 'review', 'system', {
        substate: 'tests_failed',
      }),
    ).toEqual({
      kind: 'set',
      column: 'review',
      substate: 'tests_failed',
    });
  });
  it('user cannot drag to REVIEW or DONE', () => {
    expectInvalid(() => decide(ctx('doing', 'running', { activeAttempt: attempt }), 'review', 'user'));
    expectInvalid(() => decide(ctx('doing', 'error', { activeAttempt: attempt }), 'done', 'user'));
  });
  it('retry from error', () => {
    expect(
      decide(ctx('doing', 'error', { activeAttempt: attempt }), 'doing', 'user', { action: 'retry' }),
    ).toEqual({ kind: 'retry' });
    expectInvalid(() =>
      decide(ctx('doing', 'running', { activeAttempt: attempt, hasActiveRun: true }), 'doing', 'user', {
        action: 'retry',
      }),
    );
  });
  it('error → TODO discards the attempt; running → TODO rejected', () => {
    expect(decide(ctx('doing', 'error', { activeAttempt: attempt }), 'todo', 'user')).toEqual({
      kind: 'discard',
      column: 'todo',
    });
    expectInvalid(
      () => decide(ctx('doing', 'running', { activeAttempt: attempt, hasActiveRun: true }), 'todo', 'user'),
      undefined,
      /cancel/,
    );
    expectInvalid(() =>
      decide(ctx('doing', 'queued', { activeAttempt: attempt, hasActiveRun: true }), 'todo', 'user'),
    );
  });
  it('→ BACKLOG needs confirmation when an attempt exists', () => {
    expectInvalid(
      () => decide(ctx('doing', 'error', { activeAttempt: attempt }), 'backlog', 'user'),
      'CONFIRM_REQUIRED',
    );
    expect(
      decide(ctx('doing', 'error', { activeAttempt: attempt }), 'backlog', 'user', { confirm_discard: true }),
    ).toEqual({
      kind: 'discard',
      column: 'backlog',
    });
    expectInvalid(() =>
      decide(ctx('doing', 'running', { activeAttempt: attempt, hasActiveRun: true }), 'backlog', 'user', {
        confirm_discard: true,
      }),
    );
  });
});

describe('state machine: REVIEW', () => {
  const attempt = { id: 'a1' };
  it('→ DOING requires unconsumed feedback', () => {
    expectInvalid(
      () => decide(ctx('review', 'pending', { activeAttempt: attempt }), 'doing', 'user'),
      undefined,
      /feedback/,
    );
    expect(
      decide(ctx('review', 'pending', { activeAttempt: attempt, unconsumedFeedback: 2 }), 'doing', 'user'),
    ).toEqual({ kind: 'followup' });
    expectInvalid(() =>
      decide(ctx('review', 'pending', { activeAttempt: attempt, unconsumedFeedback: 2 }), 'doing', 'system'),
    );
  });
  it('→ DONE merges (user always, system only with auto_done)', () => {
    expect(decide(ctx('review', 'pending', { activeAttempt: attempt }), 'done', 'user')).toEqual({
      kind: 'merge',
    });
    expect(decide(ctx('review', 'tests_failed', { activeAttempt: attempt }), 'done', 'user')).toEqual({
      kind: 'merge',
    });
    expectInvalid(() => decide(ctx('review', 'pending', { activeAttempt: attempt }), 'done', 'system'));
    expect(
      decide(ctx('review', 'pending', { activeAttempt: attempt, auto_done: true }), 'done', 'system'),
    ).toEqual({ kind: 'merge' });
    expectInvalid(() => decide(ctx('review', 'pending'), 'done', 'user'), undefined, /no active attempt/);
  });
  it('→ TODO discards, → BACKLOG needs confirmation', () => {
    expect(decide(ctx('review', 'pending', { activeAttempt: attempt }), 'todo', 'user')).toEqual({
      kind: 'discard',
      column: 'todo',
    });
    expectInvalid(
      () => decide(ctx('review', 'pending', { activeAttempt: attempt }), 'backlog', 'user'),
      'CONFIRM_REQUIRED',
    );
  });
  it('system substate change inside review (tests re-run)', () => {
    expect(decide(ctx('review', 'pending'), 'review', 'system', { substate: 'tests_failed' }).kind).toBe(
      'set',
    );
  });
});

describe('state machine: DONE', () => {
  it('is immutable', () => {
    for (const t of ['backlog', 'todo', 'doing', 'review'] as const) {
      expectInvalid(() => decide(ctx('done', null), t, 'user'), undefined, /immutable/);
      expectInvalid(() => decide(ctx('done', null), t, 'system', { substate: 'ready' }));
    }
    expect(decide(ctx('done', null), 'done', 'user', { position: 1 })).toEqual({ kind: 'noop' });
  });
});
