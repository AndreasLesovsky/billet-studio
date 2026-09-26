// Optimizes the source GLBs listed in models.manifest.json into public/models/<slug>.v<n>.glb.
// Usage: node models/optimize-models.mjs [--force] [--only=slug-a,slug-b]
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join as joinPath } from 'node:path';
import { readGlbJson } from './lib/glb.mjs';
import { loadManifest, mb, parseArgs, selectModels } from './lib/manifest.mjs';
import { collectStats, createIo, optimize } from './lib/optimize.mjs';

// Bump when the transform list in lib/optimize.mjs changes, so every output is rebuilt once.
const PIPELINE_REVISION = 1;
const SIZE_LIMIT_MB = 6;
const EXTRAS_KEY = 'billetStudioPipeline';

const { force, only } = parseArgs();
const manifest = loadManifest();
const models = selectModels(manifest.models, only);

const io = await createIo();

mkdirSync(manifest.outputDir, { recursive: true });

const settingsKey = (model) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        revision: PIPELINE_REVISION,
        source: model.source,
        maxTextureSize: model.maxTextureSize,
        textureQuality: manifest.textureQuality,
        simplify: model.simplify,
        excludeMaterials: model.excludeMaterials,
        losslessNormals: model.losslessNormals,
        // Only when set: a model without it keeps its key and is not rebuilt.
        ...(model.opaqueMaterials.length ? { opaqueMaterials: model.opaqueMaterials } : {}),
        // lib/optimize.mjs options the catalog does not use yet; once set they must rebuild.
        ...(model.stripUnlitNormals ? { stripUnlitNormals: true } : {}),
        ...(model.normalTextureSize !== undefined
          ? { normalTextureSize: model.normalTextureSize }
          : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16);

function isUpToDate(model, key) {
  if (force || !existsSync(model.outputPath)) return false;
  if (statSync(model.outputPath).mtimeMs < statSync(model.sourcePath).mtimeMs) return false;
  return readGlbJson(model.outputPath).asset?.extras?.[EXTRAS_KEY] === key;
}

async function optimizeModel(model, key) {
  const glb = await optimize(io, model, {
    textureQuality: manifest.textureQuality,
    extras: { [EXTRAS_KEY]: key },
  });
  const tmpPath = `${model.outputPath}.tmp`;
  writeFileSync(tmpPath, glb);
  renameSync(tmpPath, model.outputPath);
}

function printTable(rows) {
  const columns = [
    ['slug', 'slug'],
    ['sourceMb', 'source MB'],
    ['outputMb', 'output MB'],
    ['limitMb', 'limit'],
    ['sourceVertices', 'src verts'],
    ['vertices', 'verts'],
    ['textures', 'textures'],
    ['maxTexture', 'max tex'],
    ['drawCalls', 'draws'],
    ['animations', 'anims'],
    ['status', 'status'],
  ];
  const cells = rows.map((row) => columns.map(([key]) => String(row[key])));
  const widths = columns.map(([, title], i) =>
    Math.max(title.length, ...cells.map((c) => c[i].length)),
  );
  const line = (values) =>
    values.map((v, i) => (i === 0 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join('  ');
  console.log(`\n${line(columns.map(([, title]) => title))}`);
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  cells.forEach((c) => console.log(line(c)));
}

const rows = [];
for (const model of models) {
  const key = settingsKey(model);
  let action = 'skipped (up to date)';
  if (!isUpToDate(model, key)) {
    const started = performance.now();
    process.stdout.write(`optimizing ${model.slug} ... `);
    try {
      await optimizeModel(model, key);
    } catch (error) {
      rmSync(`${model.outputPath}.tmp`, { force: true });
      throw error;
    }
    action = `optimized in ${((performance.now() - started) / 1000).toFixed(1)} s`;
    console.log(action);
  } else {
    console.log(`${model.slug}: ${action}`);
  }
  const stats = await collectStats(io, model, readFileSync(model.outputPath));
  const limitMb = model.sizeLimitMB ?? SIZE_LIMIT_MB;
  const issues = [
    ...stats.problems,
    ...(stats.sizeBytes > limitMb * 1048576 ? [`over ${limitMb} MB target`] : []),
  ];
  rows.push({ ...stats, limitMb, status: issues.length ? issues.join('; ') : 'ok' });
}

printTable(rows);
const totalBytes = models.reduce((sum, m) => sum + statSync(m.outputPath).size, 0);
console.log(`\ntotal: ${mb(totalBytes)} MB in ${models.length} model(s)`);

// Files of retired slugs/versions are left in place (deleting published assets is a deliberate step).
const expected = new Set(
  manifest.models.flatMap((m) => [m.fileName, `previews/${m.slug}.v${m.version}.webp`]),
);
const previewDir = joinPath(manifest.outputDir, 'previews');
const present = [
  ...readdirSync(manifest.outputDir).filter((f) => f.endsWith('.glb')),
  ...(existsSync(previewDir) ? readdirSync(previewDir).map((f) => `previews/${f}`) : []),
];
const orphans = present.filter((f) => !expected.has(f));
if (orphans.length)
  console.warn(`
not in the manifest (delete if retired): ${orphans.join(', ')}`);

const failed = rows.filter((row) => row.status !== 'ok');
if (failed.length) {
  console.error(
    `\n${failed.length} model(s) need attention: ${failed.map((r) => r.slug).join(', ')}`,
  );
  process.exitCode = 1;
}
