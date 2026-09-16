import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { Hono } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve the built web app from `dir` with SPA fallback to index.html. */
export function mountStatic(app: Hono, dir: string): void {
  const index = join(dir, 'index.html');
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/')) return c.notFound();
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(dir, rel);
    if (file.startsWith(dir) && existsSync(file) && statSync(file).isFile()) {
      const ext = extname(file);
      const immutable = rel.startsWith('/assets/') || rel.startsWith('assets/');
      return c.body(readFileSync(file), 200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    }
    if (!existsSync(index)) return c.text('web UI not built', 404);
    return c.body(readFileSync(index), 200, { 'Content-Type': MIME['.html']!, 'Cache-Control': 'no-cache' });
  });
}
