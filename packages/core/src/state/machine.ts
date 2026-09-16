import {
  type Attempt,
  COLUMN_SUBSTATES,
  type Column,
  type Project,
  type Substate,
  type Task,
} from '@agent-kanban/shared';
import { CoreError } from '../util/errors.js';

export type Actor = 'user' | 'system';

export interface TransitionPayload {
  /** user: explicit same-column action */
  action?: 'retry';
  /** user: new position inside target column */
  position?: number;
  /** user: confirmed discarding the active attempt when moving back to backlog */
  confirm_discard?: boolean;
  /** system: target substate */
  substate?: Substate;
  /** system: error text stored on the task (DOING(error), refine failures) */
  error_message?: string;
  /** system: the project auto-starts tasks that reach TODO */
  auto_start?: boolean;
  /** system: refinement outputs */
  plan?: string;
  refinement_session_id?: string;
  refinement_incomplete?: boolean;
}

export interface TransitionContext {
  task: Pick<Task, 'column' | 'substate' | 'skip_refinement'>;
  project: Pick<Project, 'refinement_enabled' | 'auto_done'>;
  /** A run for this task is queued or running. */
  hasActiveRun: boolean;
  /** Feedback comments not yet consumed by a run. */
  unconsumedFeedback: number;
  activeAttempt: Pick<Attempt, 'id'> | null;
}

export type Decision =
  /** Only position changed (or nothing). */
  | { kind: 'noop' }
  /** Plain column/substate change, no side effects. */
  | { kind: 'set'; column: Column; substate: Substate | null }
  /** Stay in BACKLOG(refining) and create a refine run. */
  | { kind: 'start_refine' }
  /** Create attempt (worktree + branch) and execute run → DOING(queued). */
  | { kind: 'start_attempt' }
  /** Create a followup run from unconsumed feedback → DOING(queued). */
  | { kind: 'followup' }
  /** Retry after DOING(error): followup run resuming the failed session. */
  | { kind: 'retry' }
  /** Merge attempt into base branch → DONE. */
  | { kind: 'merge' }
  /** Discard the active attempt, then move to the given column. */
  | { kind: 'discard'; column: 'todo' | 'backlog' };

const invalid = (msg: string) => new CoreError('INVALID_TRANSITION', msg);

function label(task: TransitionContext['task']): string {
  return task.substate ? `${task.column.toUpperCase()}(${task.substate})` : task.column.toUpperCase();
}

/**
 * Pure transition table. Given the current context, decide what moving to
 * `target` means, or throw a CoreError (INVALID_TRANSITION / CONFIRM_REQUIRED).
 * No I/O here; effects are applied by TaskService.transition.
 */
export function decide(
  ctx: TransitionContext,
  target: Column,
  actor: Actor,
  payload: TransitionPayload = {},
): Decision {
  const { task } = ctx;
  const from = task.column;

  if (from === 'done') {
    if (target === 'done' && actor === 'user' && !payload.action) return { kind: 'noop' };
    throw invalid('DONE tasks are immutable; use "Clone task" to continue the work');
  }

  // ---- same-column moves ----------------------------------------------------
  if (target === from) {
    if (actor === 'user') {
      if (payload.action === 'retry') {
        if (from !== 'doing' || task.substate !== 'error') {
          throw invalid(`Retry is only available from DOING(error), task is ${label(task)}`);
        }
        if (ctx.hasActiveRun) throw invalid('a run is still active for this task');
        return { kind: 'retry' };
      }
      return { kind: 'noop' };
    }
    const substate = payload.substate;
    if (!substate) throw invalid(`system transition inside ${from} requires a substate`);
    assertSubstate(target, substate);
    if (from === 'backlog') {
      // draft|refining|needs_answer ↔ refining/needs_answer, plus failures back to draft
      return { kind: 'set', column: from, substate };
    }
    if (from === 'doing') {
      const ok =
        (task.substate === 'queued' && (substate === 'running' || substate === 'error')) ||
        // running → queued happens when a run is replaced by a fallback run (session lost)
        (task.substate === 'running' &&
          (substate === 'error' || substate === 'waiting_feedback' || substate === 'queued')) ||
        (task.substate === 'waiting_feedback' && (substate === 'running' || substate === 'error')) ||
        (task.substate === 'error' && substate === 'queued');
      if (!ok) throw invalid(`cannot move ${label(task)} → DOING(${substate})`);
      return { kind: 'set', column: from, substate };
    }
    if (from === 'review') return { kind: 'set', column: from, substate };
    throw invalid(`no system transition inside ${from}`);
  }

  // ---- moves back to BACKLOG (any column) -----------------------------------
  if (target === 'backlog') {
    if (actor !== 'user') throw invalid('only the user can move a task back to BACKLOG');
    if (ctx.hasActiveRun) throw invalid('cancel the running agent before moving the task back to BACKLOG');
    if (ctx.activeAttempt) {
      if (!payload.confirm_discard) {
        throw new CoreError(
          'CONFIRM_REQUIRED',
          'moving back to BACKLOG discards the current attempt (worktree and branch); confirm to proceed',
        );
      }
      return { kind: 'discard', column: 'backlog' };
    }
    return { kind: 'set', column: 'backlog', substate: 'draft' };
  }

  switch (from) {
    case 'backlog': {
      if (target !== 'todo')
        throw invalid(`BACKLOG tasks can only move to TODO (got ${target.toUpperCase()})`);
      if (actor === 'system') {
        return { kind: 'set', column: 'todo', substate: 'ready' };
      }
      if (ctx.hasActiveRun) throw invalid('refinement is already running for this task');
      const needsRefinement = ctx.project.refinement_enabled && !task.skip_refinement;
      if (needsRefinement) {
        if (task.substate === 'needs_answer') {
          throw invalid('answer the open refinement questions first, or skip refinement for this task');
        }
        return { kind: 'start_refine' };
      }
      return { kind: 'set', column: 'todo', substate: 'ready' };
    }
    case 'todo': {
      if (target === 'doing') {
        if (actor !== 'user' && !payload.auto_start) throw invalid('only the user can start a task');
        if (ctx.hasActiveRun) throw invalid('a run is already active for this task');
        if (ctx.activeAttempt) throw invalid('task already has an active attempt; discard or restart it');
        return { kind: 'start_attempt' };
      }
      throw invalid(`TODO tasks can only move to DOING or BACKLOG (got ${target.toUpperCase()})`);
    }
    case 'doing': {
      if (target === 'review') {
        if (actor !== 'user') {
          const substate = payload.substate ?? 'pending';
          assertSubstate('review', substate);
          return { kind: 'set', column: 'review', substate };
        }
        throw invalid('the system moves tasks to REVIEW once the agent has finished; you cannot drag there');
      }
      if (target === 'todo') {
        if (actor === 'system') return { kind: 'set', column: 'todo', substate: 'ready' };
        if (ctx.hasActiveRun) throw invalid('cancel the running agent before moving the task back to TODO');
        if (task.substate !== 'error')
          throw invalid(`only DOING(error) can be moved back to TODO, task is ${label(task)}`);
        return ctx.activeAttempt
          ? { kind: 'discard', column: 'todo' }
          : { kind: 'set', column: 'todo', substate: 'ready' };
      }
      throw invalid('DOING tasks reach DONE only through REVIEW');
    }
    case 'review': {
      if (target === 'doing') {
        if (actor !== 'user') throw invalid('only the user can send a task back to DOING');
        if (ctx.hasActiveRun) throw invalid('a run is already active for this task');
        if (ctx.unconsumedFeedback < 1) {
          throw invalid('add at least one feedback comment before sending the task back to the agent');
        }
        return { kind: 'followup' };
      }
      if (target === 'done') {
        if (ctx.hasActiveRun) throw invalid('a run is still active for this task');
        if (actor === 'system' && !ctx.project.auto_done)
          throw invalid('auto_done is disabled for this project');
        if (!ctx.activeAttempt) throw invalid('nothing to merge: task has no active attempt');
        return { kind: 'merge' };
      }
      if (target === 'todo') {
        if (actor === 'system') return { kind: 'set', column: 'todo', substate: 'ready' };
        return ctx.activeAttempt
          ? { kind: 'discard', column: 'todo' }
          : { kind: 'set', column: 'todo', substate: 'ready' };
      }
      throw invalid(`unsupported transition REVIEW → ${target.toUpperCase()}`);
    }
    default:
      throw invalid(`unsupported transition ${label(task)} → ${target.toUpperCase()}`);
  }
}

export function assertSubstate(column: Column, substate: Substate | null): void {
  if (substate === null) {
    if (column === 'done') return;
    throw invalid(`${column.toUpperCase()} requires a substate`);
  }
  if (!COLUMN_SUBSTATES[column].includes(substate)) {
    throw invalid(`substate "${substate}" is not valid for column ${column.toUpperCase()}`);
  }
}

/** Default substate when entering a column without an explicit one. */
export function defaultSubstate(column: Column): Substate | null {
  switch (column) {
    case 'backlog':
      return 'draft';
    case 'todo':
      return 'ready';
    case 'doing':
      return 'queued';
    case 'review':
      return 'pending';
    case 'done':
      return null;
  }
}
