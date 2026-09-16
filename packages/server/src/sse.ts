import type { Core, CoreEvent } from '@agent-kanban/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

/** GET /api/events?project_id=… — server-sent events for board/task/run updates. */
export function sseRoutes(core: Core) {
  const app = new Hono();
  app.get('/', (c) => {
    const projectId = c.req.query('project_id') ?? null;
    return streamSSE(c, async (stream) => {
      let seq = 0;
      let closed = false;
      const send = (event: CoreEvent) => {
        if (closed) return;
        if (projectId && 'project_id' in event && event.project_id && event.project_id !== projectId) return;
        if (event.type === 'job.done') return;
        void stream
          .writeSSE({ event: event.type, data: JSON.stringify(event), id: String(++seq) })
          .catch(() => {
            closed = true;
          });
      };
      const off = core.events.onAny(send);
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ project_id: projectId }) });
      const ping = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {
          closed = true;
        });
      }, 15_000);
      stream.onAbort(() => {
        closed = true;
        clearInterval(ping);
        off();
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
