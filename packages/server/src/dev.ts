// Dev entry: `pnpm --filter @agent-kanban/server dev` (API only; run the web dev server separately).
// AK_FAKE=1 swaps Claude Code for the fake agent (no API cost); AK_DB / AK_WORKTREES override paths.
import { consoleLogger, createCore } from '@agent-kanban/core';
import { startServer } from './server.js';

const logger = consoleLogger('server');
const executors = process.env.AK_FAKE
  ? { claude: new (await import('@agent-kanban/core/testing')).FakeClaudeAdapter() }
  : {};
const core = createCore({
  logger,
  executors,
  paths: {
    ...(process.env.AK_DB ? { dbPath: process.env.AK_DB } : {}),
    ...(process.env.AK_WORKTREES ? { worktreesRoot: process.env.AK_WORKTREES } : {}),
  },
});
await core.start();
const server = await startServer({
  core,
  port: Number(process.env.PORT ?? 3737),
  logger,
  findFreePort: true,
  webDistDir: process.env.AK_WEB_DIST,
});
logger.info({ url: server.url }, 'agent-kanban API listening');
const shutdown = async () => {
  await server.close();
  await core.stop({ killProcesses: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
