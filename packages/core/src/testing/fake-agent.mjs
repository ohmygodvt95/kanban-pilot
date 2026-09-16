#!/usr/bin/env node
// Fake coding agent that speaks Claude Code's stream-json protocol.
// Behaviour is driven by markers in the prompt (read from stdin):
//   FAKE:nochange   – do not modify files
//   FAKE:sleep=N    – sleep N ms before finishing
//   FAKE:fail       – exit 1 with an error result
//   FAKE:crash      – exit 2 without a result event
//   FAKE:ask        – (refine) return questions until an answer is present
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1] ?? 'execute';
const resumeIdx = args.indexOf('--resume');
const sessionId = resumeIdx >= 0 ? args[resumeIdx + 1] : randomUUID();

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

// Emulate session memory: markers from earlier prompts of the same session still apply on resume.
const sessionDir = join(tmpdir(), 'ak-fake-agent-sessions');
mkdirSync(sessionDir, { recursive: true });
const sessionFile = join(sessionDir, `${sessionId}.txt`);
const history = existsSync(sessionFile) ? readFileSync(sessionFile, 'utf8') : '';
appendFileSync(sessionFile, `${prompt}\n`);
const markers = (history.match(/FAKE:[a-z]+(=\d+)?/g) ?? []).filter((m) => !m.startsWith('FAKE:sleep'));
prompt = `${markers.join(' ')}\n${prompt}`;

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FAKE:nosession — a resumed session is "gone": mimic Claude's behaviour (stderr + error result + exit 1)
if (resumeIdx >= 0 && (prompt.includes('FAKE:nosession') || history.includes('FAKE:nosession'))) {
  process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
  emit({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    session_id: sessionId,
    num_turns: 0,
    total_cost_usd: 0,
  });
  process.exit(1);
}

emit({ type: 'system', subtype: 'init', session_id: sessionId, cwd: process.cwd(), tools: ['Write'] });
emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: sessionId });

const sleepMatch = prompt.match(/FAKE:sleep=(\d+)/);
if (sleepMatch) await sleep(Number(sleepMatch[1]));

if (prompt.includes('FAKE:crash')) {
  process.stderr.write('fake agent crashed\n');
  process.exit(2);
}
if (prompt.includes('FAKE:fail')) {
  emit({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    session_id: sessionId,
    num_turns: 1,
    total_cost_usd: 0.01,
  });
  process.exit(1);
}

if (mode === 'refine' && prompt.includes('chat với planner')) {
  const msg = prompt.split('\n')[1] ?? '';
  const structured = {
    reply: `Planner reply to: ${msg}`,
    plan: /plan/i.test(msg) ? `Updated plan because: ${msg}` : null,
  };
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: structured.reply }] },
    session_id: sessionId,
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sessionId,
    num_turns: 1,
    total_cost_usd: 0.01,
    result: JSON.stringify(structured),
    structured_output: structured,
  });
  process.exit(0);
}

if (mode === 'refine') {
  const answered = /A: /.test(prompt);
  const ready = !prompt.includes('FAKE:ask') || answered;
  const structured = ready
    ? {
        ready: true,
        questions: [],
        plan: `Plan for: ${prompt.split('\n').find((l) => l.startsWith('Task:')) ?? 'task'}`,
        affected_files: ['agent.txt'],
      }
    : {
        ready: false,
        questions: ['Which colour should the widget be?', 'Should it be exported?'],
        plan: 'tbd',
        affected_files: [],
      };
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Looking at the repo…' }] },
    session_id: sessionId,
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sessionId,
    num_turns: 2,
    total_cost_usd: 0.02,
    result: JSON.stringify(structured),
    structured_output: structured,
  });
  process.exit(0);
}

emit({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Working on it.' },
      { type: 'tool_use', name: 'Write', input: { file_path: 'agent.txt' } },
    ],
  },
  session_id: sessionId,
});
emit({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
  session_id: sessionId,
});
if (!prompt.includes('FAKE:nochange')) {
  const isFollowup = /feedback/i.test(prompt);
  if (isFollowup) {
    appendFileSync(join(process.cwd(), 'agent.txt'), `followup: ${resumeIdx >= 0 ? 'resumed' : 'fresh'}\n`);
  } else {
    mkdirSync(join(process.cwd(), 'generated'), { recursive: true });
    writeFileSync(join(process.cwd(), 'agent.txt'), 'hello from fake agent\n');
    writeFileSync(join(process.cwd(), 'generated', 'note.md'), `# note\n${prompt.slice(0, 40)}\n`);
  }
}
emit({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Done. Summary: wrote agent.txt' }] },
  session_id: sessionId,
});
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: sessionId,
  num_turns: 3,
  total_cost_usd: 0.05,
  result: 'Done.',
});
