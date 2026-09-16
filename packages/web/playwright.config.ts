import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a real agent-kanban server that uses the fake
 * executor (no API cost). `e2e/global-setup.ts` starts it on a temp database.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.AK_E2E_URL ?? 'http://127.0.0.1:3799',
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
