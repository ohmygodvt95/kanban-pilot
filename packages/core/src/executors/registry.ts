import type { ExecutorId } from '@agent-kanban/shared';
import { ClaudeAdapter } from './claude/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { CopilotAdapter } from './copilot/adapter.js';
import type { ExecutorAdapter } from './types.js';

export type ExecutorRegistry = Record<ExecutorId, ExecutorAdapter>;

/** Add a new adapter: create executors/<id>/adapter.ts and register it here. */
export function createDefaultRegistry(): ExecutorRegistry {
  return {
    claude: new ClaudeAdapter(),
    codex: new CodexAdapter(),
    copilot: new CopilotAdapter(),
  };
}

export function getExecutor(registry: ExecutorRegistry, id: ExecutorId): ExecutorAdapter {
  const adapter = registry[id];
  if (!adapter) throw new Error(`unknown executor: ${id}`);
  return adapter;
}
