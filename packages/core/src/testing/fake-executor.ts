import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter } from '../executors/claude/adapter.js';
import type { ExecutorCommand, ExecutorInput } from '../executors/types.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Claude-compatible adapter that runs the fake agent script instead of the real CLI. */
export class FakeClaudeAdapter extends ClaudeAdapter {
  override async check() {
    return { ok: true, version: 'fake' };
  }
  override buildCommand(input: ExecutorInput): ExecutorCommand {
    const args = [join(here, 'fake-agent.mjs'), '--mode', input.mode];
    if (input.resumeSessionId) args.push('--resume', input.resumeSessionId);
    return { bin: process.execPath, args, stdin: input.prompt };
  }
}
