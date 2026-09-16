import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources (no build step needed for tests).
const conditions = ['@agent-kanban/source', 'node', 'module', 'import', 'development'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
