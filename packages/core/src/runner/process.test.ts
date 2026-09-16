import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../util/logger.js';
import { attachAgent, isPidAlive, spawnAgent } from './process.js';

describe('detached process supervisor', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ak-proc-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('streams stdout/stderr lines, passes stdin, and reports the exit code', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const proc = spawnAgent({
      cwd: dir,
      logDir: join(dir, 'log'),
      command: {
        bin: '/bin/sh',
        args: ['-c', 'cat; echo "line two"; echo oops >&2; exit 3'],
        stdin: 'line one\n',
      },
      timeoutMs: 10_000,
      onStdoutLine: (l) => void out.push(l),
      onStderrLine: (l) => void err.push(l),
      logger: silentLogger,
    });
    const exit = await proc.done;
    expect(exit.exitCode).toBe(3);
    expect(out).toEqual(['line one', 'line two']);
    expect(err).toEqual(['oops']);
    expect(await readFile(join(dir, 'log', 'exit'), 'utf8')).toBe('3\n');
  });

  it('kills the whole process group on cancel and on timeout', async () => {
    const proc = spawnAgent({
      cwd: dir,
      logDir: join(dir, 'a'),
      command: { bin: '/bin/sh', args: ['-c', 'sleep 30 & wait'] },
      timeoutMs: 10_000,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      logger: silentLogger,
    });
    await new Promise((r) => setTimeout(r, 300));
    proc.kill(500);
    const exit = await proc.done;
    expect(exit.cancelled).toBe(true);
    expect(isPidAlive(proc.pid!)).toBe(false);

    const slow = spawnAgent({
      cwd: dir,
      logDir: join(dir, 'b'),
      command: { bin: '/bin/sh', args: ['-c', 'sleep 30'] },
      timeoutMs: 300,
      onStdoutLine: () => {},
      onStderrLine: () => {},
      logger: silentLogger,
    });
    const e2 = await slow.done;
    expect(e2.timedOut).toBe(true);
  });

  it('re-attaches to a running process and skips already-consumed lines', async () => {
    const first: string[] = [];
    const proc = spawnAgent({
      cwd: dir,
      logDir: join(dir, 'log'),
      command: { bin: '/bin/sh', args: ['-c', 'echo a; echo b; sleep 1; echo c; echo d'] },
      timeoutMs: 10_000,
      onStdoutLine: (l) => void first.push(l),
      onStderrLine: () => {},
      logger: silentLogger,
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(first).toEqual(['a', 'b']);
    // simulate a restarted server: attach with the lines we already have
    const second: string[] = [];
    const attached = attachAgent({
      pid: proc.pid!,
      logDir: join(dir, 'log'),
      skipStdoutLines: first.length,
      skipStderrLines: 0,
      timeoutMs: 10_000,
      onStdoutLine: (l) => void second.push(l),
      onStderrLine: () => {},
      logger: silentLogger,
    });
    const exit = await attached.done;
    expect(exit.exitCode).toBe(0);
    expect(second).toEqual(['c', 'd']);
    await proc.done;
  });

  it('reports spawn failures of a missing binary as a non-zero exit with stderr', async () => {
    const err: string[] = [];
    const proc = spawnAgent({
      cwd: dir,
      logDir: join(dir, 'log'),
      command: { bin: '/definitely/missing/bin', args: [] },
      timeoutMs: 5_000,
      onStdoutLine: () => {},
      onStderrLine: (l) => void err.push(l),
      logger: silentLogger,
    });
    const exit = await proc.done;
    expect(exit.exitCode).not.toBe(0);
    expect(err.join('\n')).toMatch(/not found|No such file/i);
  });
});
