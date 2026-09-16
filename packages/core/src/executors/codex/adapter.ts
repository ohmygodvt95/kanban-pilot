import { execa } from 'execa';
import type { ExecutorAdapter, ExecutorCommand, ExecutorInput, NormalizedEvent } from '../types.js';
import { tryParseJsonLine } from '../types.js';

/**
 * OpenAI Codex CLI adapter. Flags verified against `codex exec --help` of codex-cli 0.154.0:
 *
 *   execute: codex exec --json --skip-git-repo-check --sandbox danger-full-access [-m model] -
 *   refine : codex exec --json --skip-git-repo-check --sandbox read-only --output-schema <file> [-m model] -
 *   resume : codex exec resume --json <thread_id> -
 *
 * `-` reads the prompt from stdin. Events are JSONL (`thread.started`, `turn.started`,
 * `item.completed`, `turn.completed`, `error`); non-JSON log lines are kept as `raw`.
 * End-to-end behaviour with a logged-in account is not verified (no account on the dev machine).
 */
export class CodexAdapter implements ExecutorAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'OpenAI Codex CLI';
  readonly supportsResume = true;
  /** `--output-schema <FILE>` enforces a JSON schema for the final message. */
  readonly supportsStructuredOutput = true;
  readonly instructionFiles = ['AGENTS.md'];

  constructor(private readonly bin = process.env.AGENT_KANBAN_CODEX_BIN || 'codex') {}

  async check() {
    try {
      const { stdout } = await execa(this.bin, ['--version'], { timeout: 15_000 });
      return {
        ok: true,
        version: stdout.trim(),
        message: 'installed (run `codex login` if not authenticated)',
      };
    } catch (err) {
      return { ok: false, message: `codex binary not found: ${(err as Error).message}` };
    }
  }

  buildCommand(input: ExecutorInput): ExecutorCommand {
    const common = ['--json', '--skip-git-repo-check'];
    if (input.model) common.push('-m', input.model);
    // `-i <FILE>` attaches images to the initial prompt.
    for (const f of input.attachments ?? []) common.push('-i', f);
    if (input.resumeSessionId) {
      return {
        bin: this.bin,
        args: ['exec', 'resume', ...common, input.resumeSessionId, '-'],
        stdin: input.prompt,
      };
    }
    const args = [
      'exec',
      ...common,
      '--sandbox',
      input.mode === 'execute' ? 'danger-full-access' : 'read-only',
    ];
    if (input.mode === 'refine' && input.outputSchemaFile)
      args.push('--output-schema', input.outputSchemaFile);
    args.push('-');
    return { bin: this.bin, args, stdin: input.prompt };
  }

  classifyFailure(info: { exitCode: number | null; stderr: string }) {
    return /no (session|thread|conversation) (found|with id)|not found/i.test(info.stderr)
      ? ('session_not_found' as const)
      : ('other' as const);
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
      if (item.type === 'command_execution' || item.type === 'file_change' || item.type === 'mcp_tool_call') {
        return { type: 'tool_use', name: String(item.type), input: item, raw: obj };
      }
    }
    if (type === 'turn.completed') {
      const usage = (obj.usage ?? {}) as Record<string, unknown>;
      return {
        type: 'result',
        ok: true,
        subtype: 'success',
        raw: obj,
        numTurns: typeof usage.turns === 'number' ? usage.turns : undefined,
      };
    }
    if (type === 'turn.failed') {
      return { type: 'result', ok: false, subtype: 'error', raw: obj };
    }
    if (type === 'error') {
      return { type: 'stderr', text: String(obj.message ?? ''), raw: obj };
    }
    return { type: 'raw', raw: obj };
  }
}
