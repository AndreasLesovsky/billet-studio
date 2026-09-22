// Optimizes the source GLBs listed in models.manifest.json into public/models/<slug>.v<n>.glb.
// Usage: node models/optimize-models.mjs [--force] [--only=slug-a,slug-b]
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join as joinPath } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  getSceneVertexCount,
  instance,
  join,
  meshopt,
  prune,
  resample,
  simplify,
  textureCompress,
  VertexCountMethod,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readGlbJson } from './lib/glb.mjs';
import { loadManifest, mb, parseArgs, selectModels } from './lib/manifest.mjs';

// Bump when the transform list below changes, so every output is rebuilt once.
const PIPELINE_REVISION = 1;
const SIZE_LIMIT_MB = 6;
// Simplification is refused below this vertex count or for animated models.
const SIMPLIFY_MIN_VERTICES = 20000;
const EXTRAS_KEY = 'billetStudioPipeline';
// Lossy WebP subsamples chroma (4:2:0), which blurs the X/Y vectors a normal map stores in R/G.
const NORMAL_SLOT = /^normalTexture$/;
const NOT_NORMAL_SLOT = /^(?!normalTexture$)/;

const { force, only } = parseArgs();
const manifest = loadManifest();
const models = selectModels(manifest.models, only);

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

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
      }),
    )
    .digest('hex')
    .slice(0, 16);

function isUpToDate(model, key) {
  if (force || !existsSync(model.outputPath)) return false;
  if (statSync(model.outputPath).mtimeMs < statSync(model.sourcePath).mtimeMs) return false;
  return readGlbJson(model.outputPath).asset?.extras?.[EXTRAS_KEY] === key;
}

function simplifyTransform(model, document) {
  if (!model.simplify) return [];
  const vertices = getSceneVertexCount(
    document.getRoot().getDefaultScene(),
    VertexCountMethod.UPLOAD,
  );
  if (document.getRoot().listAnimations().length || vertices < SIMPLIFY_MIN_VERTICES) {
    console.warn(`  ${model.slug}: simplify ignored (animated or only ${vertices} vertices)`);
    return [];
  }
  const { ratio = 0.5, error = 0.001 } = model.simplify;
  return [simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: true })];
}

/** Drops primitives drawn with the given materials (e.g. scene dressing that breaks the auto-fit). */
function excludeMaterials(model, document) {
  if (!model.excludeMaterials.length) return;
  const names = new Set(model.excludeMaterials);
  let removed = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (names.has(primitive.getMaterial()?.getName())) {
        primitive.dispose();
        removed++;
      }
    }
    if (!mesh.listPrimitives().length) mesh.dispose();
  }
  if (!removed) throw new Error(`${model.slug}: excludeMaterials matched nothing`);
  console.log(`  ${model.slug}: removed ${removed} primitive(s) using ${[...names].join(', ')}`);
}

/** WebP at textureQuality; with losslessNormals, a second pass encodes normal maps lossless. */
function textureTransforms(model) {
  const options = {
    encoder: sharp,
    targetFormat: 'webp',
    quality: manifest.textureQuality,
    resize: [model.maxTextureSize, model.maxTextureSize],
  };
  if (!model.losslessNormals) return [textureCompress(options)];
  return [
    textureCompress({ ...options, slots: NOT_NORMAL_SLOT }),
    textureCompress({ ...options, slots: NORMAL_SLOT, lossless: true }),
  ];
}

async function optimize(model, key) {
  const document = await io.read(model.sourcePath);
  excludeMaterials(model, document);

  await document.transform(
    dedup(),
    instance({ min: 5 }),
    flatten(),
    join(),
    weld(),
    ...simplifyTransform(model, document),
    resample(),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
    ...textureTransforms(model),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  const asset = document.getRoot().getAsset();
  asset.extras = { ...asset.extras, [EXTRAS_KEY]: key };

  const tmpPath = `${model.outputPath}.tmp`;
  writeFileSync(tmpPath, await io.writeBinary(document));
  renameSync(tmpPath, model.outputPath);
}

/** Fails loudly if an animation or a source extension (unlit, emissive, ...) did not survive. */
function verify(sourceJson, outputJson, outputDocument) {
  const problems = [];
  const outputExtensions = new Set(outputJson.extensionsUsed ?? []);
  for (const extension of sourceJson.extensionsUsed ?? []) {
    if (!outputExtensions.has(extension)) problems.push(`extension ${extension} lost`);
  }
  for (const required of ['EXT_meshopt_compression', 'KHR_mesh_quantization']) {
    if (!outputExtensions.has(required)) problems.push(`${required} missing`);
  }
  const sourceAnimations = sourceJson.animations ?? [];
  const outputAnimations = outputDocument.getRoot().listAnimations();
  if (outputAnimations.length !== sourceAnimations.length) {
    problems.push(`animations ${sourceAnimations.length} -> ${outputAnimations.length}`);
  }
  sourceAnimations.forEach((animation, i) => {
    const channels = outputAnimations[i]?.listChannels().length ?? 0;
    if (channels !== animation.channels.length) {
      problems.push(
        `animation "${animation.name ?? i}" channels ${animation.channels.length} -> ${channels}`,
      );
    }
  });
  const nonWebp = outputDocument
    .getRoot()
    .listTextures()
    .filter((t) => t.getMimeType() !== 'image/webp');
  if (nonWebp.length) problems.push(`${nonWebp.length} texture(s) not WebP`);
  return problems;
}

function countDrawCalls(scene) {
  let drawCalls = 0;
  scene.traverse((node) => {
    // An EXT_mesh_gpu_instancing node is one draw per primitive, like a plain mesh node.
    drawCalls += node.getMesh()?.listPrimitives().length ?? 0;
  });
  return drawCalls;
}

async function collectStats(model) {
  const outputDocument = await io.read(model.outputPath);
  const outputJson = readGlbJson(model.outputPath);
  const sourceJson = readGlbJson(model.sourcePath);
  const root = outputDocument.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const textures = root.listTextures();
  const sourceVertices = (sourceJson.meshes ?? []).reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (s, p) => s + (sourceJson.accessors[p.attributes.POSITION]?.count ?? 0),
        0,
      ),
    0,
  );
  const sizeBytes = statSync(model.outputPath).size;
  const limitMb = model.sizeLimitMB ?? SIZE_LIMIT_MB;
  return {
    slug: model.slug,
    sourceMb: mb(statSync(model.sourcePath).size),
    outputMb: mb(sizeBytes),
    limitMb,
    overLimit: sizeBytes > limitMb * 1048576,
    sourceVertices,
    vertices: getSceneVertexCount(scene, VertexCountMethod.UPLOAD),
    textures: textures.length,
    maxTexture: Math.max(0, ...textures.map((t) => Math.max(...(t.getSize() ?? [0, 0])))),
    drawCalls: countDrawCalls(scene),
    animations: root.listAnimations().length,
    problems: verify(sourceJson, outputJson, outputDocument),
  };
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
      await optimize(model, key);
    } catch (error) {
      rmSync(`${model.outputPath}.tmp`, { force: true });
      throw error;
    }
    action = `optimized in ${((performance.now() - started) / 1000).toFixed(1)} s`;
    console.log(action);
  } else {
    console.log(`${model.slug}: ${action}`);
  }
  const stats = await collectStats(model);
  const issues = [
    ...stats.problems,
    ...(stats.overLimit ? [`over ${stats.limitMb} MB target`] : []),
  ];
  rows.push({ ...stats, status: issues.length ? issues.join('; ') : 'ok' });
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
