import { defineConfig, devices } from '@playwright/test';

// The app (ng serve) on 4320 and the snapshot of the live card (e2e/support/static-server.mjs) on
// 4321; the parity spec names that second origin itself.
const APP_URL = 'http://localhost:4320';

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm start -- --port 4320',
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'node e2e/support/static-server.mjs',
      url: 'http://localhost:4321/index.html',
      reuseExistingServer: true,
    },
  ],
});
