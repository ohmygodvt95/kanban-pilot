/**
 * GET /api/events?project_id=… — live board/task/run updates.
 *
 * Served two ways on the same URL:
 * - **WebSocket** (`Upgrade: websocket`): the UI's first choice. Proxies and tunnels
 *   (Cloudflare quick tunnels buffer chunked responses up to 256 KB) pass frames
 *   through immediately, whereas a server-sent event stream may sit in a buffer
 *   until it is far too late.
 * - **Server-sent events** otherwise: curl-friendly and the UI's fallback when the
 *   socket cannot be opened.
 *
 * Both send `ready` first, then every core event (filtered by project, `job.done`
 * dropped) as JSON, and a `ping` every 15 s so idle connections survive proxies.
 */
import type { Core, CoreEvent } from '@agent-kanban/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { UpgradeWebSocket, WSContext } from 'hono/ws';

const PING_MS = 15_000;

/** Subscribes `send` to the core events for a project; returns the unsubscribe function. */
function subscribe(core: Core, projectId: string | null, send: (event: CoreEvent) => void) {
  return core.events.onAny((event) => {
    if (projectId && 'project_id' in event && event.project_id && event.project_id !== projectId) return;
    if (event.type === 'job.done') return;
    send(event);
  });
}

/** Open sockets, closed on server shutdown (upgraded sockets are not tracked by http.Server). */
const liveSockets = new Set<WSContext>();
export function closeLiveSockets(): void {
  for (const ws of liveSockets) {
    try {
      ws.close(1001, 'server shutting down');
    } catch {
      /* already gone */
    }
  }
  liveSockets.clear();
}

export function sseRoutes(core: Core, upgradeWebSocket?: UpgradeWebSocket) {
  const app = new Hono();
  app.get('/', async (c, next) => {
    const projectId = c.req.query('project_id') ?? null;
    if (upgradeWebSocket && c.req.header('upgrade')?.toLowerCase() === 'websocket') {
      return upgradeWebSocket(() => {
        let off = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        const cleanup = (ws: WSContext) => {
          off();
          clearInterval(ping);
          liveSockets.delete(ws);
        };
        return {
          onOpen(_evt, ws) {
            liveSockets.add(ws);
            ws.send(JSON.stringify({ type: 'ready', project_id: projectId }));
            off = subscribe(core, projectId, (event) => ws.send(JSON.stringify(event)));
            ping = setInterval(() => ws.send(JSON.stringify({ type: 'ping', at: Date.now() })), PING_MS);
          },
          onClose(_evt, ws) {
            cleanup(ws);
          },
          onError(_evt, ws) {
            cleanup(ws);
          },
        };
      })(c, next);
    }
    return streamSSE(c, async (stream) => {
      let seq = 0;
      let closed = false;
      const write = (event: string, data: string) =>
        void stream.writeSSE({ event, data, id: String(++seq) }).catch(() => {
          closed = true;
        });
      const off = subscribe(core, projectId, (event) => {
        if (!closed) write(event.type, JSON.stringify(event));
      });
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ project_id: projectId }) });
      const ping = setInterval(() => write('ping', String(Date.now())), PING_MS);
      stream.onAbort(() => {
        closed = true;
      });
      // keep the handler alive until the client disconnects
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (closed || stream.aborted) {
            clearInterval(check);
            clearInterval(ping);
            off();
            resolve();
          }
        }, 1000);
      });
    });
  });
  return app;
}
