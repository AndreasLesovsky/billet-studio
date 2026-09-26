// Captures the posters of the home page's 3D hero from the app's REAL runtime: the dev-only page
// /dev/hero?capture&t=0|end (billet-studio-frontend/src/app/features/dev/hero-preview) draws the
// story's first frame and its idle pose into a stage as wide as the window, with a readable
// drawing buffer; the canvas itself is read (toDataURL), so a poster is exactly the frame the
// canvas fades in with - transparent where the page shows through.
//
// Posters (docs/hero-story.md, "Posters"): the start (t = 0) per language, the end (the idle pose)
// per language x colour mode (the phone's screen follows the site's mode), 512 CSS px at device
// pixel ratio 2 = 1024 px square.
//
// Output:
//   hero/.captures/poster-<name>.png                                  lossless (gitignored)
//   billet-studio-frontend/public/hero/posters/<name>.<hash8>.webp    WebP with alpha
//   hero/hero-posters.json                                            one entry per poster
// Nothing is written unless every capture succeeded; posters of earlier runs are removed.
//
// It runs against HERO_APP_URL when set (e.g. a running `ng serve` on 4200), else against 4330,
// starting its own `ng serve` there unless something already answers, and stops only what it
// started. One headless Chromium page (WebGL in SwiftShader), the captures one after another. The
// app runs as a guest (every /v1 request answers 401). Exit 1 on any capture error.
// Usage: npm run hero:posters   (runs hero:assets at its end)
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

import { CAPTURE_PORT, mockGuestApi, startAppServer, stopAppServer } from './lib/app-server.mjs';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERO_DIR, '..', '..', '..', 'billet-studio-frontend');
const CAPTURES_DIR = join(HERO_DIR, '.captures');
const POSTERS_DIR = join(FRONTEND_DIR, 'public', 'hero', 'posters');
const POSTERS_PUBLIC_PATH = 'hero/posters';
const MANIFEST_PATH = join(HERO_DIR, 'hero-posters.json');

const APP_URL = (process.env.HERO_APP_URL ?? `http://localhost:${CAPTURE_PORT}`).replace(/\/$/, '');
const CAPTURE_TIMEOUT_MS = 180_000;

const CSS_SIZE = 512;
const DPR = 2;
const PIXELS = CSS_SIZE * DPR;
const WEBP = { quality: 82, alphaQuality: 90, smartSubsample: true, effort: 6 };
const LANGS = ['de', 'en'];
const MODES = ['light', 'dark'];

function posterList() {
  const list = [];
  // The first frame shows only the printed card (paper is always light): one per language.
  for (const lang of LANGS) list.push({ kind: 'start', lang, mode: null, time: '0', textures: 'light' });
  for (const lang of LANGS) {
    for (const mode of MODES) list.push({ kind: 'end', lang, mode, time: 'end', textures: mode });
  }
  return list.map((spec) => ({ ...spec, name: [spec.kind, spec.lang, spec.mode].filter(Boolean).join('-') }));
}

async function capture(page, spec) {
  const pageErrors = [];
  const onError = (error) => pageErrors.push(error.message);
  page.on('pageerror', onError);
  try {
    const query = new URLSearchParams({ capture: '1', t: spec.time, lang: spec.lang, mode: spec.textures });
    await page.goto(`${APP_URL}/dev/hero?${query}`);
    await page.waitForFunction(() => window.__heroStory?.ready === true, null, {
      timeout: CAPTURE_TIMEOUT_MS,
    });
    const status = await page.evaluate(() => window.__heroStory.status);
    if (status !== 'ready') throw new Error(`the stage reports "${status}" (no WebGL, a broken story?)`);
    if (pageErrors.length) throw new Error(`page error: ${pageErrors.join(' | ')}`);
    const frame = await page.evaluate(() => {
      const canvas = document.querySelector('app-hero-story canvas');
      return canvas ? { width: canvas.width, height: canvas.height, url: canvas.toDataURL('image/png') } : null;
    });
    if (!frame) throw new Error('no canvas on the page');
    if (frame.width !== PIXELS || frame.height !== PIXELS) {
      throw new Error(`the canvas is ${frame.width} x ${frame.height} px, expected ${PIXELS} x ${PIXELS}`);
    }
    const png = Buffer.from(frame.url.slice(frame.url.indexOf(',') + 1), 'base64');
    const { channels, isOpaque } = await sharp(png).stats();
    if (isOpaque || channels.length < 4) throw new Error('the frame has no transparency: not the hero canvas?');
    return { ...spec, png };
  } finally {
    page.off('pageerror', onError);
  }
}

async function captureAll(specs) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const results = [];
  const errors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: CSS_SIZE, height: CSS_SIZE },
      deviceScaleFactor: DPR,
      // No pointer parallax, nothing moving but the requested frame.
      reducedMotion: 'reduce',
    });
    await mockGuestApi(context, APP_URL);
    const page = await context.newPage();
    for (const spec of specs) {
      try {
        results.push(await capture(page, spec));
        console.log(`  ok    ${spec.name}`);
      } catch (error) {
        errors.push(`${spec.name}: ${error.message}`);
        console.log(`  FAIL  ${spec.name}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return { results, errors };
}

async function writePosters(results) {
  mkdirSync(POSTERS_DIR, { recursive: true });
  const entries = [];
  for (const result of results) {
    writeFileSync(join(CAPTURES_DIR, `poster-${result.name}.png`), result.png);
    const webp = await sharp(result.png).webp(WEBP).toBuffer({ resolveWithObject: true });
    const hash = createHash('sha256').update(webp.data).digest('hex').slice(0, 8);
    const fileName = `${result.name}.${hash}.webp`;
    writeFileSync(join(POSTERS_DIR, fileName), webp.data);
    entries.push({
      kind: result.kind,
      lang: result.lang,
      mode: result.mode,
      file: `${POSTERS_PUBLIC_PATH}/${fileName}`,
      widthPx: webp.info.width,
      heightPx: webp.info.height,
      bytes: webp.data.length,
    });
  }
  return entries;
}

function removeStale(keep) {
  for (const file of readdirSync(POSTERS_DIR)) {
    if (/^[a-z-]+\.[0-9a-f]{8}\.webp$/.test(file) && !keep.has(file)) rmSync(join(POSTERS_DIR, file));
  }
}

async function main() {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const specs = posterList();
  const server = await startAppServer(FRONTEND_DIR, APP_URL);
  const stop = () => {
    stopAppServer(server);
    process.exit(130);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let outcome;
  try {
    console.log(`Capturing ${specs.length} posters from ${APP_URL} ...`);
    outcome = await captureAll(specs);
  } finally {
    stopAppServer(server);
  }
  if (outcome.errors.length) {
    console.error(`\n${outcome.errors.length} error(s); public/hero/posters and the manifest are unchanged:`);
    for (const error of outcome.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const entries = await writePosters(outcome.results);
  removeStale(new Set(entries.map((entry) => entry.file.slice(POSTERS_PUBLIC_PATH.length + 1))));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ entries }, null, 2)}\n`);
  const sizes = entries.map((entry) => `${entry.file.split('/').pop()} ${(entry.bytes / 1024).toFixed(0)} KiB`);
  console.log(`\n${entries.length} posters:\n  ${sizes.join('\n  ')}\nManifest: ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
