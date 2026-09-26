import { defineConfig, devices } from '@playwright/test';

import baseConfig, { APP_SERVER } from './playwright.config';
import {
  BACKEND_SPECS,
  BACKEND_URL,
  backendEnv,
  backendJar,
  backendWorkdir,
} from './e2e/support/e2e-stack';

/**
 * The account flows against the real backend: MariaDB from docker-compose.e2e.yml on 3307, the
 * built backend jar on 8081 and ng serve on 4320, beside a running dev stack (4200, 8080,
 * db_billet_studio), which the suite never reaches. `npm run e2e:backend` starts the database first:
 * Playwright can only wait on a URL. Both servers are reused when they already run.
 */
export default defineConfig({
  ...baseConfig,
  projects: [
    {
      name: 'backend-e2e',
      use: { ...devices['Desktop Chrome'] },
      testMatch: BACKEND_SPECS,
    },
  ],
  webServer: [
    {
      command: `java -XX:TieredStopAtLevel=1 -jar "${backendJar()}"`,
      cwd: backendWorkdir(),
      env: backendEnv(),
      url: `${BACKEND_URL}/actuator/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    APP_SERVER,
  ],
});
