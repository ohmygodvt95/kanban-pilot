#!/usr/bin/env node
import './suppress-warnings.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'start',
    port: Number(process.env.PORT ?? 3737),
    open: true,
    host: '127.0.0.1',
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
    else if (a === '--no-open') args.open = false;
    else if (a === '--host') args.host = argv[++i] ?? args.host;
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
  const core = createCore({ logger, builtinTemplatesDir: join(here, '..', 'templates') });
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
    logger.info(`${signal} received, shutting down (agent processes are terminated)`);
    await server.close();
    await core.stop({ killProcesses: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function add(args: Args) {
  const path = resolve(args.path ?? '.');
  const core = createCore({ builtinTemplatesDir: join(here, '..', 'templates') });
  try {
    const project = await core.projects.create({ repo_path: path });
    console.log(`added project "${project.name}" (${project.repo_path}) id=${project.id}`);
    console.log(`open it with: npx agent-kanban   → /p/${project.id}`);
  } catch (err) {
    console.error(`cannot add project: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await core.stop();
  }
}

async function doctor() {
  const ok = (b: boolean) => (b ? '✓' : '✗');
  const node = process.versions.node;
  const [major, minor] = node.split('.').map(Number);
  const nodeOk = (major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 13);
  console.log(`${ok(nodeOk)} node ${node} ${nodeOk ? '' : '(need ≥ 22.13 for node:sqlite)'}`);
  try {
    const { stdout } = await git(process.cwd(), ['--version']);
    console.log(`✓ ${stdout.trim()}`);
  } catch (err) {
    console.log(`✗ git not found: ${(err as Error).message}`);
  }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
    console.log('✓ node:sqlite available');
  } catch (err) {
    console.log(`✗ node:sqlite unavailable: ${(err as Error).message}`);
  }
  const registry = createDefaultRegistry();
  for (const adapter of Object.values(registry)) {
    const res = await adapter.check();
    console.log(
      `${ok(res.ok)} ${adapter.displayName}${res.version ? ` ${res.version}` : ''}${res.message ? ` — ${res.message}` : ''}`,
    );
  }
  const cwdIsRepo = await isGitRepo(process.cwd());
  console.log(`${cwdIsRepo ? '✓' : '·'} current directory ${cwdIsRepo ? 'is' : 'is not'} a git repository`);
  const paths = defaultPaths();
  console.log(`· database: ${paths.dbPath}`);
  console.log(`· worktrees: ${paths.worktreesRoot}`);
}

function help() {
  console.log(`agent-kanban ${VERSION} — kanban board that drives coding agents in git worktrees

Usage:
  agent-kanban [start] [--port 3737] [--no-open] [--host 127.0.0.1]   start the server and open the UI
  agent-kanban add [path]                                            register a git repo as a project (default: .)
  agent-kanban doctor                                                check node, git, sqlite and executor CLIs
  agent-kanban --version | --help
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
    await doctor();
    break;
  case 'version':
    console.log(VERSION);
    break;
  default:
    help();
}
