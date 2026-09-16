import { execa } from 'execa';
import type { ExecutorAdapter, ExecutorCommand, ExecutorInput, NormalizedEvent } from '../types.js';
import { tryParseJsonLine } from '../types.js';

/**
 * GitHub Copilot CLI adapter. Flags verified against `copilot --help` of GitHub Copilot CLI 1.0.85:
 *
 *   execute: copilot -p <prompt> --output-format json --allow-all --autopilot [--model m] [-r session]
 *   refine : copilot -p <prompt> --output-format json --mode plan --allow-all-tools [--model m] [-r session]
 *
 * Output is JSONL ("one JSON object per line"); the exact event vocabulary is not documented, so
 * `parseLine` maps a few likely shapes and keeps everything else as `raw`. Structured output is
 * prompt-based (no schema flag). Not verified end-to-end (no Copilot subscription on the dev machine).
 */
export class CopilotAdapter implements ExecutorAdapter {
  readonly id = 'copilot' as const;
  readonly displayName = 'GitHub Copilot CLI';
  readonly supportsResume = true;
  readonly supportsStructuredOutput = false;
  readonly instructionFiles = ['.github/copilot-instructions.md'];

  constructor(private readonly bin = process.env.AGENT_KANBAN_COPILOT_BIN || 'copilot') {}

  async check() {
    try {
      const { stdout } = await execa(this.bin, ['--version'], { timeout: 15_000 });
      return {
        ok: true,
        version: stdout.trim(),
        message: 'installed (needs COPILOT_GITHUB_TOKEN/GH_TOKEN or `copilot login`)',
      };
    } catch (err) {
      return { ok: false, message: `copilot binary not found: ${(err as Error).message}` };
    }
  }

  buildCommand(input: ExecutorInput): ExecutorCommand {
    // Copilot takes the prompt as an argument; stdin is not used.
    const args = ['-p', input.prompt, '--output-format', 'json', '--no-auto-update'];
    if (input.mode === 'execute') args.push('--allow-all', '--autopilot');
    else args.push('--mode', 'plan', '--allow-all-tools');
    if (input.model) args.push('--model', input.model);
    if (input.resumeSessionId) args.push('-r', input.resumeSessionId);
    return { bin: this.bin, args };
  }

  classifyFailure(info: { exitCode: number | null; stderr: string }) {
    return /session .*not found|no session/i.test(info.stderr)
      ? ('session_not_found' as const)
      : ('other' as const);
  }

  parseLine(line: string): NormalizedEvent | NormalizedEvent[] | null {
    const obj = tryParseJsonLine(line);
    if (!obj) return line.trim() ? { type: 'raw', raw: line } : null;
    const type = typeof obj.type === 'string' ? obj.type : '';
    const sessionId =
      typeof obj.session_id === 'string'
        ? obj.session_id
        : typeof obj.sessionId === 'string'
          ? obj.sessionId
          : undefined;
    if ((type === 'session.start' || type === 'session_start' || type === 'init') && sessionId) {
      return { type: 'init', sessionId, raw: obj };
    }
    if (
      (type === 'assistant.message' || type === 'assistant' || type === 'message') &&
      typeof obj.content === 'string'
    ) {
      return { type: 'assistant_text', text: obj.content, raw: obj };
    }
    if (type === 'tool.execution_start' || type === 'tool_call') {
      return {
        type: 'tool_use',
        name: String(obj.tool_name ?? obj.name ?? 'tool'),
        input: obj.arguments ?? obj.input,
        raw: obj,
      };
    }
    if (type === 'tool.execution_complete' || type === 'tool_result')
      return { type: 'tool_result', raw: obj };
    if (type === 'result' || type === 'session.end' || type === 'session_end' || type === 'done') {
      return {
        type: 'result',
        ok: obj.is_error !== true && obj.error === undefined,
        subtype: obj.is_error ? 'error' : 'success',
        sessionId,
        raw: obj,
      };
    }
    if (type === 'error') return { type: 'stderr', text: String(obj.message ?? obj.error ?? ''), raw: obj };
    return { type: 'raw', raw: obj };
  }
}
