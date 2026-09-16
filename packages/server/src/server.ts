import { createServer } from 'node:net';
import type { Core, Logger } from '@agent-kanban/core';
import { type ServerType, serve } from '@hono/node-server';
import { createApp } from './app.js';

export interface StartServerOptions {
  core: Core;
  port: number;
  host?: string;
  logger?: Logger;
  webDistDir?: string;
  /** Try the next ports if `port` is busy. */
  findFreePort?: boolean;
}

export interface RunningServer {
  port: number;
  url: string;
  server: ServerType;
  close(): Promise<void>;
}

export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  let port = opts.port;
  if (opts.findFreePort) {
    for (let i = 0; i < 50 && !(await isPortFree(port, host)); i++) port++;
  }
  const app = createApp({ core: opts.core, logger: opts.logger, webDistDir: opts.webDistDir });
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
      port = info.port;
      resolve(s);
    });
    s.once('error', reject);
  });
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  return {
    port,
    url,
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // SSE connections keep the server open; force-close them.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}
