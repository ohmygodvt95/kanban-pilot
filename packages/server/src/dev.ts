// Dev entry: `pnpm --filter @agent-kanban/server dev` (API only; run the web dev server separately).
import { consoleLogger, createCore } from '@agent-kanban/core';
import { startServer } from './server.js';

const logger = consoleLogger('server');
const core = createCore({ logger });
await core.start();
const server = await startServer({
  core,
  port: Number(process.env.PORT ?? 3737),
  logger,
  findFreePort: true,
});
logger.info({ url: server.url }, 'agent-kanban API listening');
const shutdown = async () => {
  await server.close();
  await core.stop({ killProcesses: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
