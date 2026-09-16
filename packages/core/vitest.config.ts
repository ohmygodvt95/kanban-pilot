import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@agent-kanban/source'] },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
