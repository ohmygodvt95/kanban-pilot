import { execa, type ResultPromise } from 'execa';
import type { ExecutorCommand } from '../executors/types.js';
import type { Logger } from '../util/logger.js';

export interface SpawnAgentOptions {
  cwd: string;
  command: ExecutorCommand;
  timeoutMs: number;
  onStdoutLine: (line: string) => void | Promise<void>;
  onStderrLine: (line: string) => void | Promise<void>;
  logger: Logger;
}

export interface AgentExit {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** Killed via kill() (user cancel). */
  cancelled: boolean;
  spawnError?: string;
}

export interface AgentProcess {
  pid: number | undefined;
  /** SIGTERM the whole process group, SIGKILL after `graceMs`. */
  kill(graceMs?: number): void;
  done: Promise<AgentExit>;
}

export function formatCommand(cmd: ExecutorCommand): string {
  const quote = (s: string) => (/[\s"'$`\\]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s);
  return [cmd.bin, ...cmd.args].map(quote).join(' ');
}

/** Send a signal to the process group of `pid` (falls back to the pid itself). */
export function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn a CLI in its own process group, stream stdout/stderr line by line and
 * resolve when it exits. Never rejects; spawn errors are reported in the exit info.
 */
export function spawnAgent(opts: SpawnAgentOptions): AgentProcess {
  let cancelled = false;
  let timedOut = false;
  let child: ResultPromise;
  try {
    child = execa(opts.command.bin, opts.command.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.command.env },
      input: opts.command.stdin,
      stdin: opts.command.stdin === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
      buffer: false,
      reject: false,
      cleanup: false,
      // large stream-json lines
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    return {
      pid: undefined,
      kill() {},
      done: Promise.resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        spawnError: String(err),
      }),
    };
  }

  let exited = false;
  const kill = (graceMs = 5000) => {
    const pid = child.pid;
    if (!pid) return;
    killTree(pid, 'SIGTERM');
    setTimeout(() => {
      if (!exited) killTree(pid, 'SIGKILL');
    }, graceMs).unref();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    opts.logger.warn({ pid: child.pid }, 'agent process timed out, killing');
    kill();
  }, opts.timeoutMs);

  const pump = async (from: 'stdout' | 'stderr', handler: (line: string) => void | Promise<void>) => {
    try {
      for await (const line of child.iterable({ from, binary: false, preserveNewlines: false })) {
        await handler(String(line));
      }
    } catch (err) {
      opts.logger.debug({ err: String(err), from }, 'stream ended with error');
    }
  };

  const done: Promise<AgentExit> = (async () => {
    const [result] = await Promise.all([
      child,
      pump('stdout', opts.onStdoutLine),
      pump('stderr', opts.onStderrLine),
    ]);
    exited = true;
    clearTimeout(timer);
    const spawnError =
      result.failed && result.exitCode === undefined && !result.signal
        ? (result.shortMessage ?? result.message)
        : undefined;
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
      signal: result.signal ?? null,
      timedOut,
      cancelled,
      spawnError,
    };
  })();

  return {
    pid: child.pid,
    kill(graceMs) {
      cancelled = true;
      kill(graceMs);
    },
    done,
  };
}

/** Run a shell script (setup/test) in cwd, capturing combined output (capped). */
export async function runScript(
  script: string,
  cwd: string,
  timeoutMs: number,
  maxOutputChars = 200_000,
): Promise<{ ok: boolean; exitCode: number | null; output: string; timedOut: boolean }> {
  const chunks: string[] = [];
  let size = 0;
  const push = (line: string) => {
    if (size > maxOutputChars) return;
    chunks.push(line);
    size += line.length + 1;
  };
  const child = execa('sh', ['-c', script], {
    cwd,
    env: { ...process.env, CI: process.env.CI ?? '1', AGENT_KANBAN: '1' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
    buffer: false,
    reject: false,
    cleanup: false,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killTree(child.pid, 'SIGTERM');
    setTimeout(() => child.pid && killTree(child.pid, 'SIGKILL'), 5000).unref();
  }, timeoutMs);
  const pump = async (from: 'stdout' | 'stderr') => {
    try {
      for await (const line of child.iterable({ from, binary: false })) push(String(line));
    } catch {
      /* stream closed */
    }
  };
  const [result] = await Promise.all([child, pump('stdout'), pump('stderr')]);
  clearTimeout(timer);
  let output = chunks.join('\n');
  if (size > maxOutputChars) output += '\n... (output truncated)';
  if (timedOut) output += `\n[timeout after ${Math.round(timeoutMs / 1000)}s]`;
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : null;
  return { ok: exitCode === 0 && !timedOut, exitCode, output, timedOut };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
