import { execa } from 'execa';
import type { ExecutorAdapter, ExecutorCommand, ExecutorInput, NormalizedEvent } from '../types.js';
import { tryParseJsonLine } from '../types.js';

/**
 * Claude Code headless adapter.
 * Verified against Claude Code 2.1.x (`claude --help`). See docs/executor-notes.md.
 *
 *  execute: claude -p --output-format stream-json --verbose --permission-mode bypassPermissions [--resume id]
 *  refine : claude -p --output-format stream-json --verbose --permission-mode plan --allowedTools Read,Grep,Glob --json-schema <schema> [--resume id]
 *
 * The prompt is always written to stdin (avoids argv length limits).
 */
export class ClaudeAdapter implements ExecutorAdapter {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly supportsResume = true;
  readonly supportsStructuredOutput = true;
  readonly instructionFiles = ['CLAUDE.md'];

  constructor(private readonly bin = process.env.AGENT_KANBAN_CLAUDE_BIN || 'claude') {}

  async check() {
    try {
      const { stdout } = await execa(this.bin, ['--version'], { timeout: 15_000 });
      const version = stdout.trim();
      // `claude auth status` exists on recent versions; treat failures as "unknown", not "not logged in".
      try {
        const auth = await execa(this.bin, ['auth', 'status'], { timeout: 15_000, reject: false });
        const out = `${auth.stdout}\n${auth.stderr}`;
        const parsed = tryParseJsonLine(auth.stdout.trim().split('\n').pop() ?? '');
        const loggedIn =
          (parsed && (parsed.loggedIn === true || parsed.logged_in === true)) ||
          /logged in|authenticated|✓/i.test(out);
        if (auth.exitCode === 0 && parsed && parsed.loggedIn === false) {
          return { ok: false, version, message: 'claude is installed but not logged in (run `claude` once)' };
        }
        return { ok: true, version, message: loggedIn ? 'logged in' : undefined };
      } catch {
        return { ok: true, version };
      }
    } catch (err) {
      return { ok: false, message: `claude binary not found or not runnable: ${(err as Error).message}` };
    }
  }

  buildCommand(input: ExecutorInput): ExecutorCommand {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (input.mode === 'refine') {
      args.push('--permission-mode', 'plan', '--allowedTools', 'Read,Grep,Glob');
      if (input.outputSchema) args.push('--json-schema', JSON.stringify(input.outputSchema));
    } else {
      args.push('--permission-mode', 'bypassPermissions');
    }
    if (input.resumeSessionId) args.push('--resume', input.resumeSessionId);
    // NOTE: `--max-turns` is not listed by `claude --help` on 2.1.x, so maxTurns is intentionally ignored here.
    if (input.systemPromptAppend) args.push('--append-system-prompt', input.systemPromptAppend);
    return { bin: this.bin, args, stdin: input.prompt, env: pickEnv() };
  }

  parseLine(line: string): NormalizedEvent | NormalizedEvent[] | null {
    const obj = tryParseJsonLine(line);
    if (!obj) {
      const text = line.trim();
      return text ? { type: 'raw', raw: text } : null;
    }
    const type = obj.type;
    if (type === 'system') {
      if (obj.subtype === 'init' && typeof obj.session_id === 'string') {
        return { type: 'init', sessionId: obj.session_id, raw: obj };
      }
      return { type: 'raw', raw: obj };
    }
    if (type === 'assistant') {
      const message = obj.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? (message?.content as unknown[]) : [];
      const events: NormalizedEvent[] = [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          events.push({ type: 'assistant_text', text: b.text, raw: obj });
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          events.push({ type: 'tool_use', name: b.name, input: b.input, raw: obj });
        }
      }
      if (events.length === 0) return { type: 'raw', raw: obj };
      return events.length === 1 ? events[0]! : events;
    }
    if (type === 'user') {
      return { type: 'tool_result', raw: obj };
    }
    if (type === 'result') {
      const subtype = typeof obj.subtype === 'string' ? obj.subtype : 'unknown';
      const isError = obj.is_error === true;
      return {
        type: 'result',
        ok: !isError && subtype === 'success',
        subtype,
        sessionId: typeof obj.session_id === 'string' ? obj.session_id : undefined,
        costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
        numTurns: typeof obj.num_turns === 'number' ? obj.num_turns : undefined,
        structuredOutput: obj.structured_output,
        resultText: typeof obj.result === 'string' ? obj.result : undefined,
        raw: obj,
      };
    }
    return { type: 'raw', raw: obj };
  }
}

/** Forward the user's auth-related env without persisting anything ourselves. */
function pickEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k.startsWith('CLAUDE_CODE_') || k.startsWith('ANTHROPIC_')) out[k] = v;
  }
  // Never let a nested Claude Code think it is inside another session.
  out.CLAUDE_CODE_ENTRYPOINT = 'agent-kanban';
  return out;
}
