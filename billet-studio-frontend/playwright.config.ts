import { defineConfig, devices } from '@playwright/test';

import { APP_URL, BACKEND_SPECS } from './e2e/support/e2e-stack';

/** ng serve for the app on 4320; the backend suite (playwright.backend.config.ts) starts it alike. */
export const APP_SERVER = {
  command: 'npm start -- --port 4320',
  url: APP_URL,
  reuseExistingServer: true,
  timeout: 180_000,
};

/**
 * The mocked suite: the specs answer every /v1 request themselves (e2e/support/*-api.ts), so it
 * needs neither a backend nor Docker. Beside the app, the snapshot of the live card
 * (e2e/support/static-server.mjs) runs on 4321; the parity spec names that origin itself.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: BACKEND_SPECS },
  ],
  webServer: [
    APP_SERVER,
    {
      command: 'node e2e/support/static-server.mjs',
      url: 'http://localhost:4321/index.html',
      reuseExistingServer: true,
    },
  ],
});
