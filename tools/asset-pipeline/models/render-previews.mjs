// Renders a WebP thumbnail of every OPTIMIZED model with preview.html in headless Chromium.
// --compare renders the SOURCE and the optimized GLB with the same settings instead, writes
// source | optimized | diff images plus pixel metrics to .compare/ (gitignored) and leaves
// public/ alone.
// Usage: node models/render-previews.mjs [--force] [--compare] [--only=slug-a,slug-b]
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
  loadManifest,
  MANIFEST_PATH,
  MODELS_DIR,
  parseArgs,
  selectModels,
} from './lib/manifest.mjs';

const PIPELINE_DIR = resolve(MODELS_DIR, '..');
const PREVIEW_PAGE = join(MODELS_DIR, 'preview.html');
const COMPARE_DIR = join(PIPELINE_DIR, '.compare');
const OUTPUT_SIZE = 512;
// Rendered at 2x and downscaled for clean edges.
const PIXEL_RATIO = 2;
const WEBP_QUALITY = 85;
const LOAD_TIMEOUT_MS = 120_000;
// Compare: the optimized model is rendered with the source's fit box so both images line up;
// its own auto-fit is reported as the fit drift. Both renders are composited on grey; a pixel
// differs strongly when a channel moves by more than STRONG_DIFF/255. A model is flagged above
// FLAG_PERCENT strong pixels (of the model's pixels), or when its silhouette or its auto-fit
// drifts by more than FLAG_DRIFT_PERCENT.
const COMPARE_BACKGROUND = 128;
const STRONG_DIFF = 8;
const FLAG_PERCENT = 3;
const FLAG_DRIFT_PERCENT = 1;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

const { force, compare, only } = parseArgs();
const manifest = loadManifest();
const models = selectModels(manifest.models, only);

const missing = models.filter((m) => !existsSync(m.outputPath));
if (missing.length) {
  throw new Error(
    `Optimized GLB missing for ${missing.map((m) => m.slug).join(', ')} - run models:optimize first`,
  );
}
mkdirSync(compare ? COMPARE_DIR : join(manifest.outputDir, 'previews'), { recursive: true });

/**
 * Serves the pipeline folder at / (page + node_modules/three), the GLB output folder at /output/ and,
 * in compare mode, the (read-only) source folder at /source/.
 */
function startServer() {
  const mounts = [
    ['/output/', manifest.outputDir],
    ...(compare ? [['/source/', manifest.sourceDir]] : []),
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

function isUpToDate(model) {
  if (force || !existsSync(model.previewPath)) return false;
  const inputs = [model.outputPath, PREVIEW_PAGE, MANIFEST_PATH, fileURLToPath(import.meta.url)];
  const newestInput = Math.max(...inputs.map((path) => statSync(path).mtimeMs));
  return statSync(model.previewPath).mtimeMs >= newestInput;
}

function previewUrl(origin, model, glbPath, { exclude = [], fitBox } = {}) {
  const { scene } = model;
  const query = new URLSearchParams({
    model: glbPath,
    size: String(OUTPUT_SIZE),
    pixelRatio: String(PIXEL_RATIO),
    fit: String(scene.fitSize),
    y: String(scene.yOffset),
    exposure: String(scene.exposure),
    distance: String(scene.cameraDistance),
    height: String(scene.cameraHeight),
    rotation: String(model.previewRotationY ?? manifest.previewRotationY),
  });
  if (exclude.length) query.set('exclude', exclude.join(','));
  if (fitBox) query.set('fitBox', fitBox);
  return `${origin}/models/preview.html?${query}`;
}

/**
 * Loads one preview URL. Returns the canvas downscaled to OUTPUT_SIZE (a sharp pipeline) and the
 * model's own auto-fit box ("cx,cy,cz,maxDim").
 */
async function render(page, url, slug) {
  await page.goto(url);
  await page.waitForFunction(() => window.__ready || window.__error, null, {
    timeout: LOAD_TIMEOUT_MS,
  });
  const error = await page.evaluate(() => window.__error);
  if (error) throw new Error(`${slug}: preview failed\n${error}`);
  const [dataUrl, fitBox] = await page.evaluate(() => [
    document.getElementById('preview').toDataURL('image/png'),
    window.__fitBox,
  ]);
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  return { image: sharp(png).resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: 'lanczos3' }), fitBox };
}

async function writePreview(page, origin, model) {
  const { image } = await render(
    page,
    previewUrl(origin, model, `/output/${model.fileName}`),
    model.slug,
  );
  const tmpPath = `${model.previewPath}.tmp`;
  await image.webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(tmpPath);
  renameSync(tmpPath, model.previewPath);
  return `rendered ${(statSync(model.previewPath).size / 1024).toFixed(1)} KB`;
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

/** Auto-fit change in % of the source size: the larger of scale change and center shift. */
function fitDriftPercent(sourceFit, outputFit) {
  const [sx, sy, sz, sourceDim] = sourceFit.split(',').map(Number);
  const [ox, oy, oz, outputDim] = outputFit.split(',').map(Number);
  const shift = Math.hypot(ox - sx, oy - sy, oz - sz) / sourceDim;
  return Math.max(Math.abs(outputDim / sourceDim - 1), shift) * 100;
}

async function compareModel(page, origin, model) {
  const raw = async (glbPath, options) => {
    const { image, fitBox } = await render(
      page,
      previewUrl(origin, model, glbPath, options),
      model.slug,
    );
    return { rgba: await image.ensureAlpha().raw().toBuffer(), fitBox };
  };
  const sourceRender = await raw(`/source/${encodeURIComponent(model.source)}`, {
    exclude: model.excludeMaterials,
  });
  const outputRender = await raw(`/output/${model.fileName}`, { fitBox: sourceRender.fitBox });
  const sourceRgba = sourceRender.rgba;
  const outputRgba = outputRender.rgba;
  const source = onGrey(sourceRgba);
  const output = onGrey(outputRgba);

  const pixels = OUTPUT_SIZE * OUTPUT_SIZE;
  const heat = Buffer.alloc(pixels * 3);
  let absSum = 0;
  let strong = 0;
  let covered = 0;
  let sourceCoverage = 0;
  let outputCoverage = 0;
  for (let p = 0; p < pixels; p++) {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(source[p * 3 + c] - output[p * 3 + c]);
      absSum += d;
      if (d > max) max = d;
    }
    const inSource = sourceRgba[p * 4 + 3] > 0;
    const inOutput = outputRgba[p * 4 + 3] > 0;
    sourceCoverage += inSource;
    outputCoverage += inOutput;
    covered += inSource || inOutput;
    strong += max > STRONG_DIFF;
    // Dimmed optimized render with the difference in red (x6).
    const base = Math.round((output[p * 3] + output[p * 3 + 1] + output[p * 3 + 2]) * 0.1);
    heat[p * 3] = Math.min(255, base + max * 6);
    heat[p * 3 + 1] = base;
    heat[p * 3 + 2] = base;
  }

  const rawInput = (input, left) => ({
    input,
    raw: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3 },
    left,
    top: 0,
  });
  await sharp({
    create: {
      width: OUTPUT_SIZE * 3,
      height: OUTPUT_SIZE,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      rawInput(source, 0),
      rawInput(output, OUTPUT_SIZE),
      rawInput(heat, OUTPUT_SIZE * 2),
    ])
    .png()
    .toFile(join(COMPARE_DIR, `${model.slug}.png`));

  const strongPercent = covered ? (strong / covered) * 100 : 0;
  const coverageDeltaPercent = sourceCoverage
    ? ((outputCoverage - sourceCoverage) / sourceCoverage) * 100
    : 0;
  const fitDrift = fitDriftPercent(sourceRender.fitBox, outputRender.fitBox);
  return {
    slug: model.slug,
    modelPixels: covered,
    meanAbsDiff: covered ? absSum / (covered * 3) : 0,
    strongPercent,
    coverageDeltaPercent,
    fitDriftPercent: fitDrift,
    flagged:
      strongPercent > FLAG_PERCENT ||
      Math.abs(coverageDeltaPercent) > FLAG_DRIFT_PERCENT ||
      fitDrift > FLAG_DRIFT_PERCENT,
  };
}

function printCompareTable(rows) {
  console.log(
    `\nslug                      model px  mean |d|  strong %  silhouette %  fit drift %  flag`,
  );
  for (const row of rows) {
    console.log(
      [
        row.slug.padEnd(24),
        String(row.modelPixels).padStart(9),
        row.meanAbsDiff.toFixed(2).padStart(9),
        row.strongPercent.toFixed(2).padStart(9),
        row.coverageDeltaPercent.toFixed(2).padStart(13),
        row.fitDriftPercent.toFixed(2).padStart(12),
        row.flagged ? '  CHECK' : '  ok',
      ].join(' '),
    );
  }
  console.log(
    `\nmean |d| = mean channel difference (of 255) over the model's pixels; strong = a channel differs by > ${STRONG_DIFF}.`,
  );
  console.log(
    "Both renders use the source's fit box; fit drift = how far the optimized model's own auto-fit moves.",
  );
  console.log(`Images: ${COMPARE_DIR}${sep}<slug>.png (source | optimized | difference x6)`);
}

const pending = compare ? models : models.filter((model) => !isUpToDate(model));
if (!compare) {
  for (const model of models.filter((m) => !pending.includes(m)))
    console.log(`${model.slug}: skipped (up to date)`);
}

if (pending.length) {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  // SwiftShader keeps WebGL available (and the output deterministic) without a GPU.
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const compareRows = [];
  try {
    const page = await browser.newPage({
      viewport: { width: OUTPUT_SIZE, height: OUTPUT_SIZE },
      deviceScaleFactor: 1,
    });
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        console.warn(`  [page ${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.warn(`  [page error] ${error.message}`));

    for (const model of pending) {
      const started = performance.now();
      let action;
      if (compare) {
        const row = await compareModel(page, origin, model);
        compareRows.push(row);
        action = `compared (strong ${row.strongPercent.toFixed(2)} %)`;
      } else {
        action = await writePreview(page, origin, model);
      }
      console.log(
        `${model.slug}: ${action} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (compare) {
    printCompareTable(compareRows);
    writeFileSync(join(COMPARE_DIR, 'report.json'), `${JSON.stringify(compareRows, null, 2)}\n`);
    const flagged = compareRows.filter((row) => row.flagged);
    if (flagged.length) console.warn(`\nlook at: ${flagged.map((row) => row.slug).join(', ')}`);
  }
}
