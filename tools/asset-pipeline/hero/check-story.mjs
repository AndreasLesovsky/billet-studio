// Early three.js check of the optimised hero story (docs/hero-story.md), before and independent of
// the Angular runtime: hero/story-check.html loads public/hero/story.<hash8>.glb exactly per the
// contract (camera from Cam / CamTarget with the authored FOV, the paused clip scrubbed, the print
// textures, an unlit screen: lock screen, the message banner by Fx_Notif, the billet page by
// Fx_Billet, the light heart under GiftSlot via fitTransform, the runtime's renderer, environment
// and lights) and renders the Blender contact sheet's times (every 0.5 s) and the full-size times
// in one headless Chromium page (SwiftShader). Writes
//   hero/.captures/story-check.png    labelled contact sheet (next to Blender's
//                                     tools/blender/hero/.renders/story/contact.png)
//   hero/.captures/story-check.json   per time: world positions of Cam, CamTarget, GiftSlot,
//                                     Phone, Card, Phone_ScreenDock and the Fx values in three.js,
//                                     compared with Blender's (tools/blender/hero/.renders/story/
//                                     checks.json "gltf_reference", when present)
//   hero/.captures/story-check-t<time>.png   the full-size frames at FULL_TIMES (as in Blender)
// Exit 1 when the page fails or a position differs from Blender's by more than TOLERANCE_MM (or an
// Fx value by more than FX_TOLERANCE): an exporter / optimiser problem.
// Usage: npm run hero:story-check [-- --hero-exposure=0.8] [-- --tone-mapping=neutral]
//        (experiments: the runtime uses exposure 1 and ACES Filmic; the files then get a suffix)
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = resolve(HERO_DIR, '..');
const PUBLIC_DIR = resolve(PIPELINE_DIR, '../../billet-studio-frontend/public');
const CAPTURES_DIR = join(HERO_DIR, '.captures');
const BLENDER_CHECKS = resolve(PIPELINE_DIR, '../blender/hero/.renders/story/checks.json');
const RENDER_SIZE = 768;
const TILE = 384;
const LABEL = 30;
const PAD = 6;
const COLS = 5;
const STEP = 0.5;
const FULL_TIMES = [0, 2.4, 4.6, 7.2, 8.8, 10];
const TOLERANCE_MM = 0.5;
const heroExposure = process.argv.find((a) => a.startsWith('--hero-exposure='))?.split('=')[1];
const toneMapping = process.argv.find((a) => a.startsWith('--tone-mapping='))?.split('=')[1];
const SUFFIX = `${heroExposure ? `-exp${heroExposure}` : ''}${toneMapping ? `-${toneMapping}` : ''}`;
const FX_TOLERANCE = 1e-3;
const TIMEOUT_MS = 120_000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function assets() {
  const story = readJson(join(HERO_DIR, 'hero-story.json'));
  const gifts = readJson(join(HERO_DIR, 'hero-gifts.json')).gifts;
  const captures = readJson(join(HERO_DIR, 'hero-captures.json')).entries;
  const templateId = story.story.gift.templateId;
  const gift = gifts.find((g) => g.templateId === templateId);
  const entry = (kind, template) =>
    captures.find(
      (e) => e.kind === kind && e.template === template && e.lang === 'de' && e.mode === 'light',
    );
  const capture = (kind, template) => entry(kind, template).file;
  const url = (file) => `/public/${file}`;
  const banner = entry('notification', templateId);
  return {
    story,
    query: new URLSearchParams({
      story: url(story.file),
      heart: url(gift.file),
      front: url(capture('print-front', templateId)),
      inside: url(capture('print-inside', templateId)),
      lock: url(capture('lock', null)),
      notification: url(banner.file),
      bannerW: String(banner.cssWidth),
      bannerH: String(banner.cssHeight),
      billet: url(capture('screen', templateId)),
      fit: String(gift.scene.fitSize),
      y: String(gift.scene.yOffset),
      exposure: String(gift.scene.exposure),
      size: String(RENDER_SIZE),
      ...(heroExposure ? { heroExposure } : {}),
      ...(toneMapping ? { toneMapping } : {}),
    }),
  };
}

function startServer() {
  const mounts = [
    ['/public/', PUBLIC_DIR],
    ['/', PIPELINE_DIR],
  ];
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const [prefix, root] = mounts.find(([p]) => pathname.startsWith(p));
    const filePath = resolve(root, `.${sep}${pathname.slice(prefix.length)}`);
    const rel = relative(root, filePath);
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

function beatAt(meta, t) {
  let id = meta.beats[0].id;
  for (const beat of meta.beats) if (t >= beat.start - 1e-9) id = beat.id;
  return id;
}

async function contactSheet(frames, meta, outPath) {
  const rows = Math.ceil(frames.length / COLS);
  const width = COLS * TILE + (COLS + 1) * PAD;
  const height = rows * (TILE + LABEL) + (rows + 1) * PAD;
  const layers = [];
  for (const [i, frame] of frames.entries()) {
    const x = PAD + (i % COLS) * (TILE + PAD);
    const y = PAD + Math.floor(i / COLS) * (TILE + LABEL + PAD);
    const tile = await sharp(Buffer.from(frame.png.split(',')[1], 'base64'))
      .resize(TILE, TILE, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    const label = `T${frame.t.toFixed(1)} ${beatAt(meta, frame.t).toUpperCase()}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL}">
      <text x="8" y="21" font-family="Consolas, monospace" font-size="18" fill="#eeeeee">${label}</text></svg>`;
    layers.push({ input: tile, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y + TILE });
  }
  await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .composite(layers)
    .png()
    .toFile(outPath);
}

function compare(frames) {
  if (!existsSync(BLENDER_CHECKS)) return { available: false };
  const reference = readJson(BLENDER_CHECKS).gltf_reference ?? [];
  const worst = { mm: 0, fx: 0 };
  const where = {};
  let matched = 0;
  for (const frame of frames) {
    const ref = reference.find((r) => Math.abs(r.t - frame.t) < 1e-6);
    if (!ref) continue;
    matched++;
    for (const [name, pos] of Object.entries(frame.nodes)) {
      if (!Array.isArray(pos) || !ref[name]) continue;
      const mm = Math.hypot(...pos.map((v, i) => v - ref[name][i])) * 1000;
      if (mm > worst.mm) (worst.mm = mm), (where.mm = `${name} @ ${frame.t}s`);
    }
    for (const [name, value] of Object.entries(frame.fx)) {
      if (!(name in (ref.fx ?? {}))) continue;
      const d = Math.abs(value - ref.fx[name]);
      if (d > worst.fx) (worst.fx = d), (where.fx = `${name} @ ${frame.t}s`);
    }
  }
  return { available: true, matched, worst, where, toleranceMm: TOLERANCE_MM, fxTolerance: FX_TOLERANCE };
}

async function main() {
  const { story, query } = assets();
  const meta = story.story;
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const frames = [];
  try {
    const page = await browser.newPage({
      viewport: { width: RENDER_SIZE, height: RENDER_SIZE },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (error) => console.warn(`  [page error] ${error.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.warn(`  [page ${m.type()}] ${m.text()}`);
    });
    await page.goto(`${origin}/hero/story-check.html?${query}`);
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: TIMEOUT_MS });
    const error = await page.evaluate(() => window.__error);
    if (error) throw new Error(`story-check.html failed\n${error}`);
    // the contact sheet's times (every STEP) plus the full-size times between them
    const grid = [];
    for (let t = 0; t <= meta.duration + 1e-9; t += STEP) grid.push(Number(t.toFixed(3)));
    const extra = FULL_TIMES.filter((t) => !grid.some((g) => Math.abs(g - t) < 1e-6));
    for (const time of [...grid, ...extra].sort((a, b) => a - b)) {
      frames.push({ t: time, ...(await page.evaluate((tt) => window.__render(tt), time)) });
    }
  } finally {
    await browser.close();
    server.close();
  }
  const sheet = join(CAPTURES_DIR, `story-check${SUFFIX}.png`);
  const onGrid = (f) => Math.abs(f.t / STEP - Math.round(f.t / STEP)) < 1e-6;
  await contactSheet(frames.filter(onGrid), meta, sheet);
  for (const frame of frames.filter((f) => FULL_TIMES.some((t) => Math.abs(t - f.t) < 1e-6))) {
    writeFileSync(
      join(CAPTURES_DIR, `story-check-t${frame.t.toFixed(1)}${SUFFIX}.png`),
      Buffer.from(frame.png.split(',')[1], 'base64'),
    );
  }
  const comparison = compare(frames);
  writeFileSync(
    join(CAPTURES_DIR, `story-check${SUFFIX}.json`),
    `${JSON.stringify({ story: story.file, comparison, frames: frames.map(({ png, ...rest }) => rest) }, null, 2)}\n`,
  );
  console.log(`Wrote ${sheet} (${frames.length} frames of ${story.file})`);
  if (!comparison.available) {
    console.warn('  no Blender reference (run the Blender story stage first): positions not compared');
    return;
  }
  const { worst, where } = comparison;
  console.log(
    `  three.js vs Blender: positions max ${worst.mm.toFixed(4)} mm (${where.mm ?? '-'}), ` +
      `Fx max ${worst.fx.toExponential(2)} (${where.fx ?? '-'}), ${comparison.matched} times`,
  );
  if (worst.mm > TOLERANCE_MM || worst.fx > FX_TOLERANCE) {
    console.error('  the optimised story does not play like the Blender scene');
    process.exit(1);
  }
}

await main();
