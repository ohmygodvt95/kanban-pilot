import { EventEmitter } from 'node:events';
import type { Attempt, Job, Run, RunEvent, Task } from '@agent-kanban/shared';

export interface CoreEventMap {
  'task.updated': { project_id: string; task: Task };
  'task.deleted': { project_id: string; task_id: string };
  'run.event': { project_id: string; task_id: string; run_id: string; seq: number; event: RunEvent };
  'run.updated': { project_id: string; run: Run };
  'attempt.updated': { project_id: string; attempt: Attempt };
  'job.failed': { project_id: string | null; job: Job; error: string };
  /** Emitted after a job finished (mainly for tests/observability). */
  'job.done': { job: Job };
}

export type CoreEventName = keyof CoreEventMap;
export type CoreEvent = { [K in CoreEventName]: { type: K } & CoreEventMap[K] }[CoreEventName];

export type Listener<K extends CoreEventName> = (payload: CoreEventMap[K]) => void;

/** Small typed event bus used to decouple core modules from transports (SSE). */
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  emit<K extends CoreEventName>(type: K, payload: CoreEventMap[K]): void {
    this.emitter.emit(type, payload);
    this.emitter.emit('*', { type, ...payload } as CoreEvent);
  }

  on<K extends CoreEventName>(type: K, listener: Listener<K>): () => void {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  once<K extends CoreEventName>(type: K, listener: Listener<K>): () => void {
    this.emitter.once(type, listener);
    return () => this.emitter.off(type, listener);
  }

  /** Subscribe to every event; used by the SSE endpoint. */
  onAny(listener: (event: CoreEvent) => void): () => void {
    this.emitter.on('*', listener);
    return () => this.emitter.off('*', listener);
  }

  /** Resolve when an event matching the predicate arrives (test helper). */
  waitFor<K extends CoreEventName>(
    type: K,
    predicate: (payload: CoreEventMap[K]) => boolean,
    timeoutMs = 10_000,
  ): Promise<CoreEventMap[K]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const off = this.on(type, (payload) => {
        if (predicate(payload)) {
          clearTimeout(timer);
          off();
          resolve(payload);
        }
      });
    });
  }
}
