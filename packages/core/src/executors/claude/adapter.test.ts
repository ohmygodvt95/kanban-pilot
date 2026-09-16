import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../types.js';
import { ClaudeAdapter } from './adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '..', '__fixtures__', name), 'utf8');

function parseAll(adapter: ClaudeAdapter, text: string): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const line of text.split('\n')) {
    const ev = adapter.parseLine(line);
    if (!ev) continue;
    if (Array.isArray(ev)) out.push(...ev);
    else out.push(ev);
  }
  return out;
}

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter('claude');

  it('builds an execute command with prompt on stdin', () => {
    const cmd = adapter.buildCommand({ cwd: '/x', prompt: 'do it', mode: 'execute', resumeSessionId: 'abc' });
    expect(cmd.bin).toBe('claude');
    expect(cmd.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--resume',
      'abc',
    ]);
    expect(cmd.stdin).toBe('do it');
    expect(cmd.env?.CLAUDE_CODE_ENTRYPOINT).toBe('agent-kanban');
  });

  it('builds a read-only refine command with json schema', () => {
    const cmd = adapter.buildCommand({
      cwd: '/x',
      prompt: 'p',
      mode: 'refine',
      outputSchema: { type: 'object' },
    });
    expect(cmd.args).toContain('plan');
    expect(cmd.args).toContain('--allowedTools');
    const idx = cmd.args.indexOf('--json-schema');
    expect(idx).toBeGreaterThan(0);
    expect(JSON.parse(cmd.args[idx + 1]!)).toEqual({ type: 'object' });
    expect(cmd.args).not.toContain('bypassPermissions');
  });

  it('parses a real execute stream (fixture from claude 2.1.x)', () => {
    const events = parseAll(adapter, fixture('claude-execute.jsonl'));
    const init = events.find((e) => e.type === 'init');
    expect(init && init.type === 'init' && init.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const tools = events.filter((e) => e.type === 'tool_use');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0] && tools[0].type === 'tool_use' && tools[0].name).toBe('Bash');
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(events.filter((e) => e.type === 'assistant_text').length).toBeGreaterThanOrEqual(2);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    if (result?.type !== 'result') throw new Error('unreachable');
    expect(result.ok).toBe(true);
    expect(result.subtype).toBe('success');
    expect(result.sessionId).toBe(init && init.type === 'init' ? init.sessionId : '');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.numTurns).toBe(2);
    expect(result.structuredOutput).toBeUndefined();
    expect(result.resultText).toContain('hello.txt');
  });

  it('parses a refine stream with structured output', () => {
    const events = parseAll(adapter, fixture('claude-refine.jsonl'));
    const result = events.at(-1);
    if (result?.type !== 'result') throw new Error('expected result');
    expect(result.ok).toBe(true);
    const so = result.structuredOutput as { ready: boolean; plan: string; questions: string[] };
    expect(so.ready).toBe(true);
    expect(Array.isArray(so.questions)).toBe(true);
    expect(so.plan.length).toBeGreaterThan(10);
    // thinking blocks and rate limit events are kept as raw, never dropped
    expect(events.some((e) => e.type === 'raw')).toBe(true);
  });

  it('classifies error results', () => {
    const ev = adapter.parseLine(
      JSON.stringify({
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        session_id: 's',
        num_turns: 5,
      }),
    );
    expect(ev && !Array.isArray(ev) && ev.type === 'result' && ev.ok).toBe(false);
    expect(ev && !Array.isArray(ev) && ev.type === 'result' && ev.subtype).toBe('error_max_turns');
  });

  it('keeps non-JSON lines as raw and ignores blank lines', () => {
    expect(adapter.parseLine('')).toBeNull();
    expect(adapter.parseLine('warning: something')).toEqual({ type: 'raw', raw: 'warning: something' });
  });
});
