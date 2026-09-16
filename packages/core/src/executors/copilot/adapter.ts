import { execa } from 'execa';
import type { ExecutorAdapter, ExecutorCommand, ExecutorInput, NormalizedEvent } from '../types.js';
import { tryParseJsonLine } from '../types.js';

/**
 * GitHub Copilot CLI adapter (v1: skeleton). `check()` works; command flags follow
 * the public docs (`copilot -p <prompt> --output-format json --autopilot --allow-all`)
 * and must be verified with `copilot --help` on the installed version.
 */
export class CopilotAdapter implements ExecutorAdapter {
  readonly id = 'copilot' as const;
  readonly displayName = 'GitHub Copilot CLI';
  readonly supportsResume = false;
  readonly supportsStructuredOutput = false;
  readonly instructionFiles = ['.github/copilot-instructions.md'];

  constructor(private readonly bin = process.env.AGENT_KANBAN_COPILOT_BIN || 'copilot') {}

  async check() {
    try {
      const { stdout } = await execa(this.bin, ['--version'], { timeout: 15_000 });
      return { ok: true, version: stdout.trim(), message: 'installed (adapter is experimental)' };
    } catch (err) {
      return { ok: false, message: `copilot binary not found: ${(err as Error).message}` };
    }
  }

  buildCommand(input: ExecutorInput): ExecutorCommand {
    const args = ['-p', input.prompt, '--output-format', 'json'];
    if (input.mode === 'execute') args.push('--autopilot', '--allow-all');
    return { bin: this.bin, args };
  }

  parseLine(line: string): NormalizedEvent | NormalizedEvent[] | null {
    const obj = tryParseJsonLine(line);
    if (!obj) return line.trim() ? { type: 'raw', raw: line } : null;
    const type = typeof obj.type === 'string' ? obj.type : '';
    if (type === 'session.start' && typeof obj.session_id === 'string') {
      return { type: 'init', sessionId: obj.session_id, raw: obj };
    }
    if (type === 'assistant.message' && typeof obj.content === 'string') {
      return { type: 'assistant_text', text: obj.content, raw: obj };
    }
    if (type === 'tool.execution_start') {
      return { type: 'tool_use', name: String(obj.tool_name ?? 'tool'), input: obj.arguments, raw: obj };
    }
    if (type === 'tool.execution_complete') return { type: 'tool_result', raw: obj };
    if (type === 'result' || type === 'session.end') {
      return {
        type: 'result',
        ok: obj.is_error !== true,
        subtype: obj.is_error ? 'error' : 'success',
        raw: obj,
      };
    }
    return { type: 'raw', raw: obj };
  }
}
