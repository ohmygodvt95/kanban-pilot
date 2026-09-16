import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright specs under e2e/ are run by `pnpm e2e`.
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'], passWithNoTests: true },
});
