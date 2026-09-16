import { execa } from 'execa';
import type { ExecutorAdapter, ExecutorCommand, ExecutorInput, NormalizedEvent } from '../types.js';
import { tryParseJsonLine } from '../types.js';

/**
 * OpenAI Codex CLI adapter (v1: skeleton). `check()` works; buildCommand follows
 * `codex exec --help` as of Codex CLI 0.x but has not been exercised end-to-end.
 * Verify flags with `codex exec --help` before relying on it (see docs/executor-notes.md).
 */
export class CodexAdapter implements ExecutorAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'OpenAI Codex CLI';
  readonly supportsResume = true;
  readonly supportsStructuredOutput = false;
  readonly instructionFiles = ['AGENTS.md'];

  constructor(private readonly bin = process.env.AGENT_KANBAN_CODEX_BIN || 'codex') {}

  async check() {
    try {
      const { stdout } = await execa(this.bin, ['--version'], { timeout: 15_000 });
      return { ok: true, version: stdout.trim(), message: 'installed (adapter is experimental)' };
    } catch (err) {
      return { ok: false, message: `codex binary not found: ${(err as Error).message}` };
    }
  }

  buildCommand(input: ExecutorInput): ExecutorCommand {
    const args = ['exec', '--json'];
    if (input.mode === 'execute') args.push('--sandbox', 'danger-full-access', '--skip-git-repo-check');
    else args.push('--sandbox', 'read-only', '--skip-git-repo-check');
    if (input.resumeSessionId) {
      // `codex exec resume <id> [prompt]` – prompt still read from stdin when "-" is given.
      return {
        bin: this.bin,
        args: ['exec', 'resume', '--json', input.resumeSessionId, '-'],
        stdin: input.prompt,
      };
    }
    args.push('-');
    return { bin: this.bin, args, stdin: input.prompt };
  }

  parseLine(line: string): NormalizedEvent | NormalizedEvent[] | null {
    const obj = tryParseJsonLine(line);
    if (!obj) return line.trim() ? { type: 'raw', raw: line } : null;
    const type = typeof obj.type === 'string' ? obj.type : '';
    if (type === 'thread.started' && typeof obj.thread_id === 'string') {
      return { type: 'init', sessionId: obj.thread_id, raw: obj };
    }
    if (type === 'item.completed') {
      const item = (obj.item ?? {}) as Record<string, unknown>;
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        return { type: 'assistant_text', text: item.text, raw: obj };
      }
      if (item.type === 'command_execution' || item.type === 'file_change') {
        return { type: 'tool_use', name: String(item.type), input: item, raw: obj };
      }
    }
    if (type === 'turn.completed') {
      return { type: 'result', ok: true, subtype: 'success', raw: obj };
    }
    if (type === 'turn.failed' || type === 'error') {
      return { type: 'result', ok: false, subtype: 'error', raw: obj };
    }
    return { type: 'raw', raw: obj };
  }
}
