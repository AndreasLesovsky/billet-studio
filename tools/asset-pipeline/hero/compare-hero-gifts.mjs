// Renders every light hero gift (hero-gifts.json) next to its catalog version (public/models) with
// models/preview.html at the hero's size: CSS_SIZE px at DPR 2, shown 1:1 in device pixels.
// The hero auto-rotates the gift, so each one is rendered at ROTATION_STEPS evenly spaced angles
// (starting at the catalog preview angle) and judged by its worst angle.
// The light model uses the catalog model's fit box so both renders line up; its own auto-fit is
// reported as the fit drift, like models:compare.
//
// Output (gitignored):
//   hero/.captures/gifts-compare.png          one row per gift at its worst angle:
//                                             catalog | light | difference x6
//   hero/.captures/gifts-compare-<slug>.png   one row per angle, for a closer look
// Usage: npm run hero:compare (after hero:gifts)
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { loadManifest } from '../models/lib/manifest.mjs';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = resolve(HERO_DIR, '..');
const GIFTS_DIR = resolve(PIPELINE_DIR, '../../billet-studio-frontend/public');
const CAPTURES_DIR = join(HERO_DIR, '.captures');
const GIFTS_JSON_PATH = join(HERO_DIR, 'hero-gifts.json');

const CSS_SIZE = 320;
const PIXEL_RATIO = 2;
const TILE = CSS_SIZE * PIXEL_RATIO;
const LABEL = 36;
const GAP = 16;
const LOAD_TIMEOUT_MS = 120_000;
// As in models/render-previews.mjs --compare.
const COMPARE_BACKGROUND = 128;
const STRONG_DIFF = 8;
const ROTATION_STEPS = 4;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

/**
 * The pipeline folder at / (preview page + node_modules/three), the catalog GLBs at /catalog/ and
 * public/ (hero-gifts.json's public-relative files) at /public/. Only 127.0.0.1.
 */
function startServer(catalogDir) {
  const mounts = [
    ['/catalog/', catalogDir],
    ['/public/', GIFTS_DIR],
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
    const inside = !rel.startsWith('..') && !isAbsolute(rel);
    if (!inside || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  });
  return new Promise((resolveServer) => server.listen(0, '127.0.0.1', () => resolveServer(server)));
}

function previewUrl(origin, model, rotation, glbPath, fitBox) {
  const { scene } = model;
  const query = new URLSearchParams({
    model: glbPath,
    size: String(CSS_SIZE),
    pixelRatio: String(PIXEL_RATIO),
    fit: String(scene.fitSize),
    y: String(scene.yOffset),
    exposure: String(scene.exposure),
    distance: String(scene.cameraDistance),
    height: String(scene.cameraHeight),
    rotation: String(rotation),
  });
  if (fitBox) query.set('fitBox', fitBox);
  return `${origin}/models/preview.html?${query}`;
}

async function render(page, url, label) {
  await page.goto(url);
  await page.waitForFunction(() => window.__ready || window.__error, null, {
    timeout: LOAD_TIMEOUT_MS,
  });
  const error = await page.evaluate(() => window.__error);
  if (error) throw new Error(`${label}: preview failed\n${error}`);
  const [dataUrl, fitBox] = await page.evaluate(() => [
    document.getElementById('preview').toDataURL('image/png'),
    window.__fitBox,
  ]);
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const rgba = await sharp(png).resize(TILE, TILE).ensureAlpha().raw().toBuffer();
  return { rgba, fitBox };
}

/** Straight RGBA -> RGB composited on grey, so transparent pixels compare equal. */
function onGrey(rgba) {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    const alpha = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      rgb[o + c] = Math.round(rgba[i + c] * alpha + COMPARE_BACKGROUND * (1 - alpha));
  }
  return rgb;
}

function diff(catalogRgba, lightRgba) {
  const catalog = onGrey(catalogRgba);
  const light = onGrey(lightRgba);
  const heat = Buffer.alloc(catalog.length);
  let strong = 0;
  let covered = 0;
  for (let p = 0; p < TILE * TILE; p++) {
    let max = 0;
    for (let c = 0; c < 3; c++)
      max = Math.max(max, Math.abs(catalog[p * 3 + c] - light[p * 3 + c]));
    covered += catalogRgba[p * 4 + 3] > 0 || lightRgba[p * 4 + 3] > 0;
    strong += max > STRONG_DIFF;
    // Dimmed light render with the difference in red (x6).
    const base = Math.round((light[p * 3] + light[p * 3 + 1] + light[p * 3 + 2]) * 0.1);
    heat[p * 3] = Math.min(255, base + max * 6);
    heat[p * 3 + 1] = base;
    heat[p * 3 + 2] = base;
  }
  return { catalog, light, heat, strongPercent: covered ? (strong / covered) * 100 : 0 };
}

function fitDriftPercent(catalogFit, lightFit) {
  const [sx, sy, sz, catalogDim] = catalogFit.split(',').map(Number);
  const [ox, oy, oz, lightDim] = lightFit.split(',').map(Number);
  const shift = Math.hypot(ox - sx, oy - sy, oz - sz) / catalogDim;
  return Math.max(Math.abs(lightDim / catalogDim - 1), shift) * 100;
}

const escapeXml = (text) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const kb = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

function label(text, width) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}">` +
      `<text x="4" y="25" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#e6e6ea">` +
      `${escapeXml(text)}</text></svg>`,
  );
}

/** One row: three labelled tiles. Returns its sharp composites, offset by `top`. */
function rowComposites(row, top) {
  const raw = (input) => ({ input, raw: { width: TILE, height: TILE, channels: 3 } });
  const tiles = [
    [row.catalog, `${row.slug} @ ${row.rotation.toFixed(2)} rad - catalog ${kb(row.catalogBytes)}`],
    [row.light, `light ${kb(row.lightBytes)} (${row.triangles} tris)`],
    [
      row.heat,
      `diff x6 - strong ${row.strongPercent.toFixed(1)} %, drift ${row.drift.toFixed(2)} %`,
    ],
  ];
  return tiles.flatMap(([pixels, text], i) => {
    const left = GAP + i * (TILE + GAP);
    return [
      { input: label(text, TILE), left, top },
      { ...raw(pixels), left, top: top + LABEL },
    ];
  });
}

async function writeSheet(rows, path) {
  const rowHeight = LABEL + TILE + GAP;
  await sharp({
    create: {
      width: GAP + 3 * (TILE + GAP),
      height: GAP + rows.length * rowHeight,
      channels: 3,
      background: { r: 58, g: 58, b: 64 },
    },
  })
    .composite(rows.flatMap((row, i) => rowComposites(row, GAP + i * rowHeight)))
    .png()
    .toFile(path);
}

if (!existsSync(GIFTS_JSON_PATH)) throw new Error('hero-gifts.json missing - run hero:gifts first');
const { gifts } = JSON.parse(readFileSync(GIFTS_JSON_PATH, 'utf8'));
const catalog = loadManifest();
mkdirSync(CAPTURES_DIR, { recursive: true });

const server = await startServer(catalog.outputDir);
const origin = `http://127.0.0.1:${server.address().port}`;
// SwiftShader keeps WebGL available (and the output deterministic) without a GPU.
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const rows = [];
try {
  const page = await browser.newPage({
    viewport: { width: CSS_SIZE, height: CSS_SIZE },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => console.warn(`  [page error] ${error.message}`));
  for (const gift of gifts) {
    const model = catalog.models.find((m) => m.slug === gift.slug);
    const start = model.previewRotationY ?? catalog.previewRotationY;
    const angleRows = [];
    for (let step = 0; step < ROTATION_STEPS; step++) {
      const rotation = start + (step * 2 * Math.PI) / ROTATION_STEPS;
      const catalogRender = await render(
        page,
        previewUrl(origin, model, rotation, `/catalog/${model.fileName}`),
        `${gift.slug} (catalog)`,
      );
      const lightRender = await render(
        page,
        previewUrl(origin, model, rotation, `/public/${gift.file}`, catalogRender.fitBox),
        `${gift.slug} (light)`,
      );
      angleRows.push({
        slug: gift.slug,
        rotation,
        catalogBytes: statSync(model.outputPath).size,
        lightBytes: gift.bytes,
        triangles: gift.triangles,
        drift: fitDriftPercent(catalogRender.fitBox, lightRender.fitBox),
        ...diff(catalogRender.rgba, lightRender.rgba),
      });
    }
    const worst = angleRows.reduce((a, b) => (b.strongPercent > a.strongPercent ? b : a));
    rows.push(worst);
    await writeSheet(angleRows, join(CAPTURES_DIR, `gifts-compare-${gift.slug}.png`));
    const perAngle = angleRows.map((row) => row.strongPercent.toFixed(2)).join(' / ');
    console.log(
      `${gift.slug.padEnd(18)} ${kb(worst.catalogBytes).padStart(10)} -> ${kb(worst.lightBytes).padStart(9)}` +
        `  worst strong ${worst.strongPercent.toFixed(2).padStart(6)} % @ ${worst.rotation.toFixed(2)} rad` +
        ` (${perAngle})  max fit drift ${Math.max(...angleRows.map((r) => r.drift)).toFixed(2)} %`,
    );
  }
} finally {
  await browser.close();
  server.close();
}

await writeSheet(rows, join(CAPTURES_DIR, 'gifts-compare.png'));
console.log(`\nstrong = a channel differs by > ${STRONG_DIFF}/255, of the model's pixels;`);
console.log(`the sheet shows each gift at its worst of ${ROTATION_STEPS} angles.`);
console.log(`wrote ${join(CAPTURES_DIR, 'gifts-compare.png')}`);
