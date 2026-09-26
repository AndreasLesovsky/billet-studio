// Captures the textures of the home page's 3D hero from the app's REAL renderer: the dev-only route
// /dev/hero-capture/:kind (billet-studio-frontend/src/app/features/dev/hero-capture) draws each one
// with BilletView at a fixed CSS size, Playwright screenshots it.
//
// Output:
//   hero/.captures/<name>.png          lossless PNGs (gitignored; Blender reads the print ones)
//   hero/.captures/contact.png         every capture, scaled and labelled
//   hero/.captures/crop-text.png       1:1 crop of text of the Valentinstag DE light screen
//   billet-studio-frontend/public/hero/textures/<name>.<hash>.webp   the site's textures
//   hero/hero-captures.json            one entry per texture
// Nothing is written unless every capture succeeded, so .captures always matches the textures.
//
// A phone screen is captured 390 CSS px wide and past the phone's 844 px window down to a block
// boundary (the PNG, for the text crop); its texture is the 390x844 window alone, and its
// sceneRect is normalised to that window.
//
// It starts its own `ng serve` on 4330 unless something already answers there, and stops only what
// it started. The app runs as a guest (every /v1 request answers 401). Exit 1 on any capture error
// or when a template's scene area differs between light and dark.
// Usage: npm run hero:capture
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(HERO_DIR, '..', '..', '..');
const FRONTEND_DIR = join(REPO_DIR, 'billet-studio-frontend');
const CAPTURES_DIR = join(HERO_DIR, '.captures');
const TEXTURES_DIR = join(FRONTEND_DIR, 'public', 'hero', 'textures');
const TEXTURES_PUBLIC_PATH = 'hero/textures';
const MANIFEST_PATH = join(HERO_DIR, 'hero-captures.json');

// Not the developer's 4200, not the e2e ports 4320/4321.
const PORT = 4330;
const APP_URL = `http://localhost:${PORT}`;
const SERVER_TIMEOUT_MS = 300_000;
const CAPTURE_TIMEOUT_MS = 60_000;
const CONCURRENCY = 4;

const WEBP_QUALITY = 86;
const SCENE_TOLERANCE_CSS_PX = 0.5;
const SHOWCASE = 'valentinstag';
const LANGS = ['de', 'en'];
const MODES = ['light', 'dark'];
const LOCALES = { de: 'de-DE', en: 'en-US' };

/** CSS size (a screen's: the phone's window) and device pixel ratio per kind; print is paper, so always light. */
const KINDS = {
  'print-front': { css: [420, 592], dpr: 2.5 },
  'print-inside': { css: [840, 592], dpr: 2.5 },
  screen: { css: [390, 844], dpr: 2 },
  lock: { css: [390, 844], dpr: 2 },
  notification: { css: [358, 120], dpr: 2, transparent: true },
};

const CONTACT_SCALE = 0.6;
const CONTACT_WIDTH = 2600;
const CONTACT_GAP = 24;
const CONTACT_LABEL = 30;
/** Room for the longest label under a narrow tile (the notification). */
const CONTACT_MIN_CELL = 300;

/** TEMPLATE_IDS as the app declares them, so a new template is captured without touching this. */
function templateIds() {
  const source = readFileSync(
    join(FRONTEND_DIR, 'src', 'app', 'billet', 'templates', 'templates.ts'),
    'utf8',
  );
  const list = /export const TEMPLATE_IDS = \[([^\]]*)\]/.exec(source)?.[1];
  const ids = [...(list ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  if (!ids.includes(SHOWCASE)) throw new Error('TEMPLATE_IDS not found in templates.ts');
  return ids;
}

function captureName({ kind, template, lang, mode }) {
  return [kind, template, lang, mode].filter(Boolean).join('-');
}

function captureList() {
  const list = [];
  const add = (kind, template, lang, mode) => {
    const spec = { kind, template, lang, mode, ...KINDS[kind] };
    list.push({ ...spec, name: captureName(spec) });
  };
  for (const kind of ['print-front', 'print-inside']) {
    for (const lang of LANGS) add(kind, SHOWCASE, lang, 'light');
  }
  for (const template of templateIds()) {
    for (const lang of LANGS) for (const mode of MODES) add('screen', template, lang, mode);
  }
  for (const lang of LANGS) for (const mode of MODES) add('lock', null, lang, mode);
  for (const lang of LANGS) for (const mode of MODES) add('notification', SHOWCASE, lang, mode);
  return list;
}

// ===== The app server =====

async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/** ng serve on PORT (npm start runs the generators first); null when one already answers. */
async function startServer() {
  if (await answers(APP_URL)) {
    console.log(`Using the server that already answers on ${APP_URL}.`);
    return null;
  }
  console.log(`Starting ng serve on ${APP_URL} ...`);
  const windows = process.platform === 'win32';
  // One command string: npm is a .cmd on Windows and needs the shell there.
  const child = spawn(`npm start -- --port ${PORT} --no-hmr --no-live-reload`, {
    cwd: FRONTEND_DIR,
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
    if (await answers(APP_URL)) return child;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  stopServer(child);
  throw new Error(`ng serve did not answer within ${SERVER_TIMEOUT_MS / 1000} s:\n${tail}`);
}

/** Stops the process tree this script spawned, never anything else. */
function stopServer(child) {
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

// ===== Capturing =====

const CORS_HEADERS = {
  'access-control-allow-origin': APP_URL,
  'access-control-allow-credentials': 'true',
};

/** As in a browser without WebGL: the screen's scene area stays empty either way (no model). */
function withoutWebGl() {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...options) {
    return String(type).includes('webgl') ? null : getContext.call(this, type, ...options);
  };
}

async function capture(browser, spec) {
  const [width, height] = spec.css;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: spec.dpr,
    colorScheme: spec.mode,
    locale: LOCALES[spec.lang],
    reducedMotion: 'reduce',
  });
  try {
    // A guest: the refresh on startup and everything else is 401, like e2e's mockGuestApi.
    await context.route('**/v1/**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ errorCode: 'UNAUTHORIZED', status: 401, timestamp: '2026-01-01T00:00:00Z' }),
      }),
    );
    await context.addInitScript(withoutWebGl);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const query = new URLSearchParams({
      ...(spec.template ? { template: spec.template } : {}),
      lang: spec.lang,
      mode: spec.mode,
    });
    await page.goto(`${APP_URL}/dev/hero-capture/${spec.kind}?${query}`);
    await page.waitForFunction(() => window.__heroCapture !== undefined, null, {
      timeout: CAPTURE_TIMEOUT_MS,
    });
    const state = await page.evaluate(() => window.__heroCapture);
    if (!state.ready) throw new Error(state.error);
    if (pageErrors.length) throw new Error(`page error: ${pageErrors.join(' | ')}`);
    await failOnErrorToast(page);

    // A screen runs past the window: the viewport grows with it (the billet's layout follows its
    // width only), so the whole capture is on screen.
    const expectedHeight = spec.kind === 'screen' ? screenHeight(state, height) : height;
    if (expectedHeight !== height) {
      await page.setViewportSize({ width, height: expectedHeight });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    }
    const target = page.locator('#capture');
    const box = await target.boundingBox();
    if (!box || Math.abs(box.width - width) > 0.01 || Math.abs(box.height - expectedHeight) > 0.01) {
      throw new Error(`#capture is ${box?.width} x ${box?.height}, expected ${width} x ${expectedHeight}`);
    }
    const png = await target.screenshot({
      omitBackground: spec.transparent === true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    });
    await failOnErrorToast(page);
    const textRect = spec.kind === 'screen' ? await visibleTextRect(page) : null;
    return {
      ...spec,
      png,
      cssWidth: box.width,
      cssHeight: box.height,
      viewport: spec.kind === 'screen' ? { cssWidth: width, cssHeight: height } : null,
      sceneRect: state.sceneRect ?? null,
      textRect,
    };
  } finally {
    await context.close();
  }
}

/** A screen's reported height: whole CSS px, never shorter than the phone's window. */
function screenHeight(state, windowHeight) {
  const reported = state.cssHeight;
  if (!Number.isInteger(reported) || reported < windowHeight) {
    throw new Error(`screen height ${reported} is not a whole number of CSS px >= ${windowHeight}`);
  }
  return reported;
}

async function failOnErrorToast(page) {
  const toast = page.locator('.ui-toast--danger');
  if ((await toast.count()) > 0) {
    throw new Error(`error toast: ${(await toast.first().innerText()).trim()}`);
  }
}

/** The hero's title and sub line, or the first paragraph when one is on screen: text for a 1:1 crop. */
function visibleTextRect(page) {
  return page.evaluate(() => {
    const capture = document.querySelector('#capture').getBoundingClientRect();
    const inside = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.height > 0 && rect.bottom <= capture.bottom ? rect : null;
    };
    const paragraph = document.querySelector('#capture .paragraph p');
    const rects = paragraph && inside(paragraph)
      ? [inside(paragraph)]
      : ['#capture .hero-title', '#capture .hero-sub']
          .map((selector) => document.querySelector(selector))
          .filter(Boolean)
          .map(inside)
          .filter(Boolean);
    if (!rects.length) return null;
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: 0, y: top - capture.top, w: capture.width, h: bottom - top };
  });
}

async function captureAll(specs) {
  const browser = await chromium.launch();
  const results = [];
  const errors = [];
  try {
    let next = 0;
    const worker = async () => {
      while (next < specs.length) {
        const spec = specs[next++];
        try {
          results.push(await capture(browser, spec));
          console.log(`  ok    ${spec.name}`);
        } catch (error) {
          errors.push(`${spec.name}: ${error.message}`);
          console.log(`  FAIL  ${spec.name}: ${error.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    await browser.close();
  }
  const order = new Map(specs.map((spec, index) => [spec.name, index]));
  results.sort((a, b) => order.get(a.name) - order.get(b.name));
  return { results, errors };
}

// ===== Checks and output =====

/**
 * The 3D gift sits on the scene area: it must not move when the phone switches light/dark, and the
 * screen texture must keep its size so the window shows the same part.
 */
function sceneRectErrors(results) {
  const errors = [];
  for (const light of results.filter((r) => r.kind === 'screen' && r.mode === 'light')) {
    const dark = results.find(
      (r) => r.kind === 'screen' && r.mode === 'dark' && r.template === light.template && r.lang === light.lang,
    );
    if (!dark || !light.sceneRect || !dark.sceneRect) {
      errors.push(`${light.template}-${light.lang}: scene area missing`);
      continue;
    }
    if (light.cssHeight !== dark.cssHeight) {
      errors.push(`${light.template}-${light.lang}: screen height ${light.cssHeight} (light) vs ${dark.cssHeight} (dark)`);
    }
    const [windowWidth, windowHeight] = light.css;
    const scale = { x: windowWidth, w: windowWidth, y: windowHeight, h: windowHeight };
    for (const key of ['x', 'y', 'w', 'h']) {
      const delta = Math.abs(light.sceneRect[key] - dark.sceneRect[key]) * scale[key];
      if (delta > SCENE_TOLERANCE_CSS_PX) {
        errors.push(`${light.template}-${light.lang}: scene ${key} differs by ${delta.toFixed(2)} CSS px`);
      }
    }
  }
  return errors;
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

async function writeTextures(results) {
  mkdirSync(TEXTURES_DIR, { recursive: true });
  const entries = [];
  for (const result of results) {
    let image = sharp(result.png);
    let cssHeight = result.cssHeight;
    if (result.viewport) {
      // The texture is the phone's window only: a real screen cuts text at its edge too.
      const { width: pngWidth } = await sharp(result.png).metadata();
      const scale = pngWidth / result.cssWidth;
      cssHeight = result.viewport.cssHeight;
      image = image.extract({ left: 0, top: 0, width: pngWidth, height: Math.round(cssHeight * scale) });
    }
    if (!result.transparent) image = image.removeAlpha();
    const webp = await image
      .webp({ quality: WEBP_QUALITY, smartSubsample: true, alphaQuality: 100, effort: 6 })
      .toBuffer({ resolveWithObject: true });
    const hash = createHash('sha256').update(webp.data).digest('hex').slice(0, 8);
    const fileName = `${result.name}.${hash}.webp`;
    writeFileSync(join(TEXTURES_DIR, fileName), webp.data);
    entries.push({
      kind: result.kind,
      template: result.template,
      lang: result.lang,
      mode: result.mode,
      file: `${TEXTURES_PUBLIC_PATH}/${fileName}`,
      widthPx: webp.info.width,
      heightPx: webp.info.height,
      bytes: webp.data.length,
      cssWidth: result.cssWidth,
      cssHeight,
      sceneRect: result.sceneRect && {
        x: round(result.sceneRect.x),
        y: round(result.sceneRect.y),
        w: round(result.sceneRect.w),
        h: round(result.sceneRect.h),
      },
    });
  }
  return entries;
}

/** Removes what an earlier run wrote and this one did not: old hashes, dropped captures. */
function removeStale(dir, keep, pattern) {
  for (const file of readdirSync(dir)) {
    if (pattern.test(file) && !keep.has(file)) rmSync(join(dir, file));
  }
}

function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function writeContactSheet(results) {
  const tiles = [];
  for (const result of results) {
    const width = Math.round(result.cssWidth * CONTACT_SCALE);
    const image = await sharp(result.png).resize({ width }).png().toBuffer({ resolveWithObject: true });
    tiles.push({ result, image: image.data, width: image.info.width, height: image.info.height });
  }
  const composites = [];
  let x = CONTACT_GAP;
  let y = CONTACT_GAP;
  let rowHeight = 0;
  let previousKind = null;
  for (const tile of tiles) {
    const cell = Math.max(tile.width, CONTACT_MIN_CELL);
    const newRow = x + cell + CONTACT_GAP > CONTACT_WIDTH || (previousKind && previousKind !== tile.result.kind);
    if (newRow && x > CONTACT_GAP) {
      x = CONTACT_GAP;
      y += rowHeight + CONTACT_LABEL + CONTACT_GAP;
      rowHeight = 0;
    }
    previousKind = tile.result.kind;
    composites.push({ input: tile.image, left: x, top: y });
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${CONTACT_LABEL}">` +
        `<text x="0" y="20" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#e6e6ea">` +
        `${escapeXml(tile.result.name)}</text></svg>`,
    );
    composites.push({ input: label, left: x, top: y + tile.height + 4 });
    x += cell + CONTACT_GAP;
    rowHeight = Math.max(rowHeight, tile.height);
  }
  const height = y + rowHeight + CONTACT_LABEL + CONTACT_GAP;
  await sharp({
    create: { width: CONTACT_WIDTH, height, channels: 4, background: { r: 58, g: 58, b: 64, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(join(CAPTURES_DIR, 'contact.png'));
}

async function writeTextCrop(results) {
  const screen = results.find(
    (r) => r.kind === 'screen' && r.template === SHOWCASE && r.lang === 'de' && r.mode === 'light',
  );
  if (!screen?.textRect) throw new Error('no text found on the Valentinstag DE light screen');
  const { x, y, w, h } = screen.textRect;
  const pad = 12;
  const meta = await sharp(screen.png).metadata();
  const left = Math.max(0, Math.floor((x - pad) * screen.dpr));
  const top = Math.max(0, Math.floor((y - pad) * screen.dpr));
  const width = Math.min(meta.width - left, Math.ceil((w + 2 * pad) * screen.dpr));
  const height = Math.min(meta.height - top, Math.ceil((h + 2 * pad) * screen.dpr));
  await sharp(screen.png)
    .extract({ left, top, width, height })
    .png()
    .toFile(join(CAPTURES_DIR, 'crop-text.png'));
}

// ===== Main =====

async function main() {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const specs = captureList();
  const server = await startServer();
  const stop = () => {
    stopServer(server);
    process.exit(130);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let outcome;
  try {
    console.log(`Capturing ${specs.length} textures ...`);
    outcome = await captureAll(specs);
  } finally {
    stopServer(server);
  }
  const errors = [...outcome.errors, ...sceneRectErrors(outcome.results)];
  if (errors.length) {
    console.error(`\n${errors.length} error(s); .captures, public/hero/textures and the manifest are unchanged:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const results = outcome.results;
  for (const result of results) writeFileSync(join(CAPTURES_DIR, `${result.name}.png`), result.png);
  const entries = await writeTextures(results);
  removeStale(
    TEXTURES_DIR,
    new Set(entries.map((entry) => entry.file.slice(TEXTURES_PUBLIC_PATH.length + 1))),
    /^[a-z0-9-]+\.[0-9a-f]{8}\.webp$/,
  );
  removeStale(
    CAPTURES_DIR,
    new Set([...results.map((r) => `${r.name}.png`), 'contact.png', 'crop-text.png']),
    /\.png$/,
  );
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ entries }, null, 2)}\n`);
  await writeContactSheet(results);
  await writeTextCrop(results);

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const largest = entries.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  console.log(
    `\n${entries.length} textures, ${(total / 1024).toFixed(0)} KiB; largest ${largest.file} ` +
      `(${(largest.bytes / 1024).toFixed(0)} KiB). Manifest: ${MANIFEST_PATH}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
