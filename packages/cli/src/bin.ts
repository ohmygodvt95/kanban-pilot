#!/usr/bin/env node
import './suppress-warnings.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  CoreError,
  createCore,
  createDefaultRegistry,
  defaultPaths,
  git,
  isGitRepo,
  type Logger,
} from '@agent-kanban/core';
import { startServer } from '@agent-kanban/server';
import pino from 'pino';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
const here = dirname(fileURLToPath(import.meta.url));

interface Args {
  command: 'start' | 'add' | 'doctor' | 'help' | 'version';
  port: number;
  open: boolean;
  host: string;
  path?: string;
  /** `add`: adopt setup/test scripts from the repo's .agent-kanban.json without prompting. */
  acceptScripts: boolean;
  /** `start`: terminate running agents on Ctrl-C instead of leaving them detached. */
  killAgents: boolean;
  /** Days to keep event streams of DONE runs (0 = forever). */
  retentionDays: number;
  /** `doctor`: print checks as a JSON array instead of text lines. */
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'start',
    port: Number(process.env.PORT ?? 3737),
    open: true,
    host: '127.0.0.1',
    acceptScripts: false,
    killAgents: false,
    retentionDays: Number(process.env.AK_RETENTION_DAYS ?? 30),
    json: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
    else if (a === '--no-open') args.open = false;
    else if (a === '--host') args.host = argv[++i] ?? args.host;
    else if (a === '--accept-scripts' || a === '-y') args.acceptScripts = true;
    else if (a === '--kill-agents') args.killAgents = true;
    else if (a === '--retention-days') args.retentionDays = Number(argv[++i]);
    else if (a.startsWith('--retention-days=')) args.retentionDays = Number(a.slice(17));
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.command = 'help';
    else if (a === '-v' || a === '--version') args.command = 'version';
    else rest.push(a);
  }
  if (rest[0] === 'add') {
    args.command = 'add';
    args.path = rest[1] ?? '.';
  } else if (rest[0] === 'doctor') args.command = 'doctor';
  else if (rest[0] === 'start' || rest.length === 0)
    args.command = args.command === 'start' ? 'start' : args.command;
  else if (args.command === 'start') {
    console.error(`unknown command: ${rest[0]}`);
    args.command = 'help';
  }
  return args;
}

function makeLogger(): Logger & pino.Logger {
  const pretty = process.stdout.isTTY && !process.env.AK_JSON_LOGS;
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } }
      : {}),
  }) as Logger & pino.Logger;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* ignore */
  }
}

function webDistDir(): string | undefined {
  for (const c of [join(here, 'web'), join(here, '..', 'web'), join(here, '..', '..', 'web', 'dist')]) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return undefined;
}

async function start(args: Args) {
  const logger = makeLogger();
  const core = createCore({
    logger,
    builtinTemplatesDir: join(here, '..', 'templates'),
    retentionDays: args.retentionDays,
  });
  await core.start();
  const web = webDistDir();
  if (!web) logger.warn('web UI not found next to the CLI; only the API will be served');
  const server = await startServer({
    core,
    port: args.port,
    host: args.host,
    logger,
    webDistDir: web,
    findFreePort: true,
  });
  if (server.port !== args.port) logger.info(`port ${args.port} was busy, using ${server.port}`);
  logger.info(`agent-kanban ${VERSION} listening at ${server.url}  (db: ${defaultPaths().dbPath})`);
  if (args.open) openBrowser(server.url);
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    const active = core.runner.activeRunIds.length;
    if (active && !args.killAgents) {
      logger.info(
        `${signal} received; ${active} agent run(s) keep working in the background and are re-attached on the next start (use --kill-agents to stop them)`,
      );
    } else if (active) logger.info(`${signal} received; terminating ${active} agent run(s)`);
    else logger.info(`${signal} received, shutting down`);
    await server.close();
    await core.stop({ killProcesses: args.killAgents });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Interactive yes/no on a TTY; false when stdin is not interactive. */
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function add(args: Args) {
  const path = resolve(args.path ?? '.');
  const core = createCore({ builtinTemplatesDir: join(here, '..', 'templates') });
  try {
    let accept = args.acceptScripts;
    for (;;) {
      try {
        const project = await core.projects.create({ repo_path: path, accept_repo_scripts: accept });
        console.log(`added project "${project.name}" (${project.repo_path}) id=${project.id}`);
        console.log(`open it with: npx agent-kanban   → /p/${project.id}`);
        return;
      } catch (err) {
        // The repo's .agent-kanban.json defines scripts: show them before running anything.
        if (err instanceof CoreError && err.code === 'CONFIRM_REQUIRED' && !accept) {
          const scripts = err.details as { setup_script: string | null; test_script: string | null };
          console.log(
            `${path}/.agent-kanban.json defines scripts that agent-kanban would run on this machine:`,
          );
          if (scripts.setup_script) console.log(`  setup_script: ${scripts.setup_script}`);
          if (scripts.test_script) console.log(`  test_script:  ${scripts.test_script}`);
          accept = await askYesNo('Adopt these scripts?');
          if (!accept) {
            console.error(
              'aborted (re-run with --accept-scripts to adopt them, or add the project from the UI)',
            );
            process.exitCode = 1;
            return;
          }
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    console.error(`cannot add project: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await core.stop();
  }
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

async function doctor(args: Args) {
  const checks: DoctorCheck[] = [];
  const sym = (b: boolean) => (b ? '✓' : '✗');
  const log = (line: string) => {
    if (!args.json) console.log(line);
  };

  const node = process.versions.node;
  const [major, minor] = node.split('.').map(Number);
  const nodeOk = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 13);
  checks.push({
    name: 'node',
    ok: nodeOk,
    detail: `node ${node}${nodeOk ? '' : ' (need ≥ 22.13 for node:sqlite)'}`,
  });
  log(`${sym(nodeOk)} node ${node} ${nodeOk ? '' : '(need ≥ 22.13 for node:sqlite)'}`);

  try {
    const { stdout } = await git(process.cwd(), ['--version']);
    const detail = stdout.trim();
    checks.push({ name: 'git', ok: true, detail });
    log(`✓ ${detail}`);
  } catch (err) {
    const detail = `git not found: ${(err as Error).message}`;
    checks.push({ name: 'git', ok: false, detail });
    log(`✗ ${detail}`);
  }

  try {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
    checks.push({ name: 'node:sqlite', ok: true, detail: 'available' });
    log('✓ node:sqlite available');
  } catch (err) {
    const detail = `unavailable: ${(err as Error).message}`;
    checks.push({ name: 'node:sqlite', ok: false, detail });
    log(`✗ node:sqlite ${detail}`);
  }

  const registry = createDefaultRegistry();
  for (const adapter of Object.values(registry)) {
    const res = await adapter.check();
    const detail =
      res.version && res.message ? `${res.version} — ${res.message}` : (res.version ?? res.message ?? '');
    checks.push({ name: adapter.displayName, ok: res.ok, detail });
    log(
      `${sym(res.ok)} ${adapter.displayName}${res.version ? ` ${res.version}` : ''}${res.message ? ` — ${res.message}` : ''}`,
    );
  }

  const ghToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  console.log(
    `${ghToken ? '✓' : '·'} GITHUB_TOKEN/GH_TOKEN ${ghToken ? 'set (GitHub issues, status sync, pull requests)' : 'not set (GitHub features disabled)'}`,
  );
  const glToken = !!process.env.GITLAB_TOKEN;
  console.log(
    `${glToken ? '✓' : '·'} GITLAB_TOKEN ${glToken ? 'set (GitLab issues, status sync, merge requests)' : 'not set (GitLab features disabled)'}`,
  );
  const cwdIsRepo = await isGitRepo(process.cwd());
  const repoDetail = `current directory ${cwdIsRepo ? 'is' : 'is not'} a git repository`;
  checks.push({ name: 'git repository', ok: cwdIsRepo, detail: repoDetail });
  log(`${cwdIsRepo ? '✓' : '·'} ${repoDetail}`);

  const paths = defaultPaths();
  checks.push({ name: 'database', ok: true, detail: paths.dbPath });
  log(`· database: ${paths.dbPath}`);
  checks.push({ name: 'worktrees', ok: true, detail: paths.worktreesRoot });
  log(`· worktrees: ${paths.worktreesRoot}`);

  if (args.json) console.log(JSON.stringify(checks, null, 2));
}

function help() {
  console.log(`agent-kanban ${VERSION} — kanban board that drives coding agents in git worktrees

Usage:
  agent-kanban [start] [--port 3737] [--no-open] [--host 127.0.0.1]   start the server and open the UI
      --kill-agents          terminate running agents on exit (default: they keep running and are re-attached)
      --retention-days N     delete event streams of DONE runs older than N days (default 30, 0 = never)
  agent-kanban add [path] [--accept-scripts|-y]                      register a git repo as a project (default: .)
  agent-kanban doctor [--json]                                       check node, git, sqlite, executor CLIs, GitHub token
      --json                 print the checks as a JSON array of { name, ok, detail } instead of text lines
  agent-kanban --version | --help

Environment: GITHUB_TOKEN / GH_TOKEN, GITLAB_TOKEN (issue import, status sync, PR/MR), ANTHROPIC_* / CLAUDE_CODE_* (forwarded to Claude Code),
             XDG_CONFIG_HOME / XDG_CACHE_HOME (db, worktrees and logs location), LOG_LEVEL, PORT.
`);
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case 'start':
    await start(args);
    break;
  case 'add':
    await add(args);
    break;
  case 'doctor':
    await doctor(args);
    break;
  case 'version':
    console.log(VERSION);
    break;
  default:
    help();
}
