import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['@agent-kanban/source'] },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.AK_API_PORT ?? 3737}`, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1500 },
  // unit tests of pure modules only; Playwright owns e2e/
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
