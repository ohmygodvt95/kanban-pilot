import type { Task } from '@agent-kanban/shared';
import { describe, expect, it } from 'vitest';
import { isFiltering, matchesFilter } from './filter';

const task = (over: Partial<Task>): Task =>
  ({
    id: 't1',
    project_id: 'p',
    title: 'Fix login bug',
    description: 'users cannot sign in',
    column: 'backlog',
    substate: 'draft',
    position: 0,
    executor: null,
    model: null,
    browser: null,
    kind: null,
    priority: null,
    skip_refinement: false,
    plan: null,
    refinement_session_id: null,
    refinement_incomplete: false,
    current_attempt_id: null,
    last_error: null,
    source_provider: null,
    source_external_id: null,
    source_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    total_cost_usd: 0,
    unconsumed_feedback: 0,
    ...over,
  }) as Task;

describe('board filter', () => {
  it('searches title, description and id case-insensitively', () => {
    expect(matchesFilter(task({}), { query: 'LOGIN', executor: '', quick: 'all' }, 'claude')).toBe(true);
    expect(matchesFilter(task({}), { query: 'sign in', executor: '', quick: 'all' }, 'claude')).toBe(true);
    expect(matchesFilter(task({}), { query: 't1', executor: '', quick: 'all' }, 'claude')).toBe(true);
    expect(matchesFilter(task({}), { query: 'nope', executor: '', quick: 'all' }, 'claude')).toBe(false);
  });

  it('falls back to the project executor when the task has none', () => {
    expect(matchesFilter(task({}), { query: '', executor: 'claude', quick: 'all' }, 'claude')).toBe(true);
    expect(matchesFilter(task({}), { query: '', executor: 'codex', quick: 'all' }, 'claude')).toBe(false);
    expect(
      matchesFilter(task({ executor: 'codex' }), { query: '', executor: 'codex', quick: 'all' }, 'claude'),
    ).toBe(true);
  });

  it('quick filters: attention, running, bugs, urgent', () => {
    const f = (quick: 'attention' | 'running' | 'bugs' | 'urgent') => ({
      query: '',
      executor: '' as const,
      quick,
    });
    expect(matchesFilter(task({ column: 'doing', substate: 'error' }), f('attention'), 'claude')).toBe(true);
    expect(matchesFilter(task({ column: 'review', substate: 'pending' }), f('attention'), 'claude')).toBe(
      true,
    );
    expect(matchesFilter(task({ column: 'todo', substate: 'ready' }), f('attention'), 'claude')).toBe(false);
    expect(matchesFilter(task({ column: 'doing', substate: 'queued' }), f('running'), 'claude')).toBe(true);
    expect(matchesFilter(task({ column: 'doing', substate: 'error' }), f('running'), 'claude')).toBe(false);
    expect(matchesFilter(task({ kind: 'bug' }), f('bugs'), 'claude')).toBe(true);
    expect(matchesFilter(task({ kind: 'feature' }), f('bugs'), 'claude')).toBe(false);
    expect(matchesFilter(task({ priority: 'high' }), f('urgent'), 'claude')).toBe(true);
    expect(matchesFilter(task({ priority: 'low' }), f('urgent'), 'claude')).toBe(false);
  });

  it('reports whether any filter is active', () => {
    expect(isFiltering({ query: '  ', executor: '', quick: 'all' })).toBe(false);
    expect(isFiltering({ query: 'x', executor: '', quick: 'all' })).toBe(true);
    expect(isFiltering({ query: '', executor: 'claude', quick: 'all' })).toBe(true);
    expect(isFiltering({ query: '', executor: '', quick: 'bugs' })).toBe(true);
  });
});
