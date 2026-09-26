import { defineConfig, devices } from '@playwright/test';

import { APP_URL, BACKEND_SPECS } from './e2e/support/e2e-stack';

/**
 * ng serve for the app on 4320; the backend suite (playwright.backend.config.ts) starts it alike.
 * One build per run: no watching, so an edit made during a run never rebuilds or reloads a page
 * mid-test, and no HMR, whose per-component requests queued behind the parallel workers.
 */
export const APP_SERVER = {
  command: 'npm start -- --port 4320 --no-watch --no-live-reload --no-hmr',
  url: APP_URL,
  reuseExistingServer: true,
  timeout: 180_000,
};

/** Pixel comparisons of full pages: one at a time, beside the other specs. */
const PARITY_SPEC = 'parity.spec.ts';

/**
 * The mocked suite: the specs answer every /v1 request themselves (e2e/support/*-api.ts), so it
 * needs neither a backend nor Docker. Beside the app, the snapshot of the live card
 * (e2e/support/static-server.mjs) runs on 4321; the parity spec names that origin itself.
 *
 * Reduced motion everywhere: the model's rotation and the petals kept software WebGL (headless
 * Chromium has no GPU) and the trace's screencast busy on every frame, which starved parallel
 * workers until pages missed their timeouts. No spec depends on motion.
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
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [...BACKEND_SPECS, PARITY_SPEC],
    },
    {
      name: 'parity',
      use: { ...devices['Desktop Chrome'] },
      testMatch: PARITY_SPEC,
      workers: 1,
    },
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
