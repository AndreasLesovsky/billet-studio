// The app server the hero captures run against (capture-hero.mjs, capture-hero-posters.mjs): an
// `ng serve` of billet-studio-frontend on the capture port 4330 (not the developer's 4200, not the
// e2e ports 4320/4321), started only when nothing answers there, and stopped only when started here.
import { spawn, spawnSync } from 'node:child_process';

export const CAPTURE_PORT = 4330;
const SERVER_TIMEOUT_MS = 300_000;

export async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * ng serve on `port` (npm start runs the generators first); null when something already answers on
 * `appUrl`, which is then used as it is.
 */
export async function startAppServer(frontendDir, appUrl, port = CAPTURE_PORT) {
  if (await answers(appUrl)) {
    console.log(`Using the server that already answers on ${appUrl}.`);
    return null;
  }
  console.log(`Starting ng serve on ${appUrl} ...`);
  const windows = process.platform === 'win32';
  // One command string: npm is a .cmd on Windows and needs the shell there.
  const child = spawn(`npm start -- --port ${port} --no-hmr --no-live-reload`, {
    cwd: frontendDir,
    shell: true,
    detached: !windows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const keep = (chunk) => (tail = (tail + chunk).slice(-4_000));
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const started = Date.now();
  while (Date.now() - started < SERVER_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`ng serve exited (${child.exitCode}):\n${tail}`);
    if (await answers(appUrl)) return child;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  stopAppServer(child);
  throw new Error(`ng serve did not answer within ${SERVER_TIMEOUT_MS / 1000} s:\n${tail}`);
}

/** Stops the process tree startAppServer spawned, never anything else. */
export function stopAppServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

/** Every /v1 request answers 401: the app runs as a guest, like e2e's mockGuestApi. */
export async function mockGuestApi(context, appUrl) {
  await context.route('**/v1/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': appUrl,
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify({ errorCode: 'UNAUTHORIZED', status: 401, timestamp: '2026-01-01T00:00:00Z' }),
    }),
  );
}
