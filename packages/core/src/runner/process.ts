/**
 * Process supervision for agent CLIs.
 *
 * Agents are started *detached* through a tiny `sh` wrapper that redirects the
 * CLI's stdin/stdout/stderr to files inside a per-run log directory and writes
 * the exit code to `exit` when the CLI ends:
 *
 *   <log_dir>/prompt.txt   what was piped to stdin
 *   <log_dir>/stdout.log   JSONL stream of the CLI (tailed live)
 *   <log_dir>/stderr.log   diagnostics (tailed live)
 *   <log_dir>/exit         "<code>\n", written when the CLI exits
 *
 * Because the process does not depend on our stdio pipes, agent-kanban can be
 * restarted while an agent is working: `attachAgent` re-tails the log files of a
 * still-running pid (see JobRunner.recover). The wrapper is the process-group
 * leader, so `kill(-pid)` terminates the CLI and everything it spawned.
 */
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { ExecutorCommand } from '../executors/types.js';
import type { Logger } from '../util/logger.js';

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
  logDir: string;
  /** SIGTERM the whole process group, SIGKILL after `graceMs`. */
  kill(graceMs?: number): void;
  done: Promise<AgentExit>;
}

interface StreamHandlers {
  onStdoutLine: (line: string) => void | Promise<void>;
  onStderrLine: (line: string) => void | Promise<void>;
  logger: Logger;
}

export interface SpawnAgentOptions extends StreamHandlers {
  cwd: string;
  command: ExecutorCommand;
  timeoutMs: number;
  /** Directory for prompt/stdout/stderr/exit files (created if missing). */
  logDir: string;
}

export interface AttachAgentOptions extends StreamHandlers {
  pid: number;
  logDir: string;
  /** Lines already persisted from a previous process; they are skipped on re-attach. */
  skipStdoutLines: number;
  skipStderrLines: number;
  /** Remaining time before the run is considered timed out. */
  timeoutMs: number;
}

export const LOG_FILES = {
  prompt: 'prompt.txt',
  stdout: 'stdout.log',
  stderr: 'stderr.log',
  exit: 'exit',
  cmd: 'command.json',
} as const;

/** Human-readable rendering of a command (stored on the run for debugging). */
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

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read `<logDir>/exit` if present. */
export function readExitFile(logDir: string): number | null | undefined {
  const file = join(logDir, LOG_FILES.exit);
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, 'utf8').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Incrementally read a growing file and emit complete lines. `skip` lines are
 * consumed silently (used when re-attaching). Returns a `drain()` that reads
 * whatever is left and a `stop()`.
 */
function tailFile(
  path: string,
  skip: number,
  onLine: (line: string) => void | Promise<void>,
  intervalMs = 200,
) {
  let offset = 0;
  let carry = '';
  let skipped = 0;
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const readNew = () => {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size <= offset) return;
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      const n = readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      carry += buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
    const parts = carry.split('\n');
    carry = parts.pop() ?? '';
    for (const line of parts) {
      if (skipped < skip) {
        skipped++;
        continue;
      }
      queue = queue.then(() => onLine(line)).catch(() => {});
    }
  };

  const timer = setInterval(() => {
    if (!stopped) readNew();
  }, intervalMs);
  timer.unref();

  return {
    async drain() {
      stopped = true;
      clearInterval(timer);
      readNew();
      if (carry.trim() && skipped >= skip) queue = queue.then(() => onLine(carry)).catch(() => {});
      carry = '';
      await queue;
    },
  };
}

/**
 * Wait for the wrapper to finish: the `exit` file appears, or the pid vanishes
 * (e.g. SIGKILL of the whole group, in which case no exit file is written).
 */
function waitForExit(
  pid: number,
  logDir: string,
  intervalMs = 250,
): Promise<{ exitCode: number | null; fileFound: boolean }> {
  return new Promise((resolve) => {
    let deadChecks = 0;
    const timer = setInterval(() => {
      const code = readExitFile(logDir);
      if (code !== undefined) {
        clearInterval(timer);
        resolve({ exitCode: code, fileFound: true });
        return;
      }
      if (!isPidAlive(pid)) {
        // give the wrapper a moment to flush the exit file after the CLI ended
        if (++deadChecks >= 3) {
          clearInterval(timer);
          resolve({ exitCode: readExitFile(logDir) ?? null, fileFound: false });
        }
      } else deadChecks = 0;
    }, intervalMs);
  });
}

/** Common supervision loop for spawned and re-attached processes. */
function supervise(
  pid: number,
  logDir: string,
  opts: StreamHandlers & { timeoutMs: number; skipStdout?: number; skipStderr?: number },
): AgentProcess {
  let cancelled = false;
  let timedOut = false;
  let exited = false;
  const kill = (graceMs = 5000) => {
    killTree(pid, 'SIGTERM');
    setTimeout(() => {
      if (!exited) killTree(pid, 'SIGKILL');
    }, graceMs).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    opts.logger.warn({ pid }, 'agent process timed out, killing');
    kill();
  }, opts.timeoutMs);
  timer.unref();

  const out = tailFile(join(logDir, LOG_FILES.stdout), opts.skipStdout ?? 0, opts.onStdoutLine);
  const err = tailFile(join(logDir, LOG_FILES.stderr), opts.skipStderr ?? 0, opts.onStderrLine);

  const done: Promise<AgentExit> = (async () => {
    const res = await waitForExit(pid, logDir);
    exited = true;
    clearTimeout(timer);
    await Promise.all([out.drain(), err.drain()]);
    const signal = !res.fileFound
      ? 'SIGKILL'
      : res.exitCode !== null && res.exitCode > 128
        ? `SIG${res.exitCode - 128}`
        : null;
    return { exitCode: res.exitCode, signal, timedOut, cancelled };
  })();

  return {
    pid,
    logDir,
    kill(graceMs) {
      cancelled = true;
      kill(graceMs);
    },
    done,
  };
}

/**
 * Start a CLI detached from this process. Never rejects; spawn errors are
 * reported in the exit info.
 */
export function spawnAgent(opts: SpawnAgentOptions): AgentProcess {
  const { logDir, command } = opts;
  mkdirSync(logDir, { recursive: true });
  const promptFile = join(logDir, LOG_FILES.prompt);
  writeFileSync(promptFile, command.stdin ?? '');
  writeFileSync(
    join(logDir, LOG_FILES.cmd),
    JSON.stringify({ cwd: opts.cwd, bin: command.bin, args: command.args }, null, 2),
  );
  for (const f of [LOG_FILES.stdout, LOG_FILES.stderr]) writeFileSync(join(logDir, f), '');

  // "$0" "$@" keeps every argument intact (no shell re-quoting of the prompt / schema).
  const script = `"$0" "$@" < "$AK_STDIN" > "$AK_STDOUT" 2> "$AK_STDERR"; echo $? > "$AK_EXIT"`;
  let pid: number | undefined;
  try {
    const child = spawn('/bin/sh', ['-c', script, command.bin, ...command.args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...command.env,
        AK_STDIN: command.stdin === undefined ? '/dev/null' : promptFile,
        AK_STDOUT: join(logDir, LOG_FILES.stdout),
        AK_STDERR: join(logDir, LOG_FILES.stderr),
        AK_EXIT: join(logDir, LOG_FILES.exit),
      },
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      writeFileSync(join(logDir, LOG_FILES.stderr), `${String(err)}\n`, { flag: 'a' });
      writeFileSync(join(logDir, LOG_FILES.exit), '127\n');
    });
    child.unref();
    pid = child.pid;
  } catch (err) {
    return {
      pid: undefined,
      logDir,
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
  if (!pid) {
    return {
      pid: undefined,
      logDir,
      kill() {},
      done: Promise.resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        spawnError: 'spawn returned no pid',
      }),
    };
  }
  return supervise(pid, logDir, opts);
}

/** Re-attach to an agent started by a previous agent-kanban process. */
export function attachAgent(opts: AttachAgentOptions): AgentProcess {
  return supervise(opts.pid, opts.logDir, {
    ...opts,
    skipStdout: opts.skipStdoutLines,
    skipStderr: opts.skipStderrLines,
  });
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
