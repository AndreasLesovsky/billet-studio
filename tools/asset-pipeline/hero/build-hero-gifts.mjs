// Builds the light gift models of the home page's 3D hero from the catalog's SOURCE GLBs (never
// from public/models, which would encode the textures lossy twice), with the catalog's transform
// list (models/lib/optimize.mjs) and the per-gift settings of hero.manifest.json.
//
// Output:
//   billet-studio-frontend/public/hero/gifts/<slug>.<hash>.glb   content-hashed, stale ones removed
//   hero/hero-gifts.json                                          one entry per gift
// The source, excludeMaterials, opaqueMaterials, credit and scene defaults come from the catalog
// entry (models.manifest.json); maxTextureSize, textureQuality and losslessNormals fall back to it.
// Hero-only settings: simplify.flags (meshoptimizer Prune/Permissive/...), simplify.keepMaterials
// (materials whose primitives stay unsimplified), stripUnlitNormals and normalTextureSize (the size
// of the lossless normal maps), see models/lib/optimize.mjs.
// Nothing is written unless every gift passes verify() and its sizeLimitKB (exit 1 otherwise).
// Nothing goes into sql/seed_models.sql.
// Usage: npm run hero:gifts
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCredit, readGlbJson } from '../models/lib/glb.mjs';
import { loadManifest } from '../models/lib/manifest.mjs';
import { collectStats, createIo, optimize } from '../models/lib/optimize.mjs';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(HERO_DIR, '../../../billet-studio-frontend/src/app/billet/templates');
const MANIFEST_PATH = join(HERO_DIR, 'hero.manifest.json');
const GIFTS_JSON_PATH = join(HERO_DIR, 'hero-gifts.json');
const HASHED_GIFT = /^[a-z0-9-]+\.[0-9a-f]{8}\.glb$/;
const GIFT_KEYS = new Set([
  'templateId',
  'slug',
  'sizeLimitKB',
  'maxTextureSize',
  'textureQuality',
  'losslessNormals',
  'normalTextureSize',
  'stripUnlitNormals',
  'simplify',
]);
const SIMPLIFY_KEYS = new Set(['ratio', 'error', 'flags', 'keepMaterials']);
const SIMPLIFY_FLAGS = new Set(['Prune', 'Permissive', 'Regularize', 'RegularizeLight']);
const SCENE_KEYS = [
  'fitSize',
  'yOffset',
  'exposure',
  'cameraDistance',
  'cameraHeight',
  'autoRotateSpeed',
];

/** TEMPLATE_IDS and each template's modelSlug as the app declares them. */
function templateModels() {
  const list = readFileSync(join(TEMPLATES_DIR, 'templates.ts'), 'utf8');
  const ids = /export const TEMPLATE_IDS = \[([^\]]*)\]/.exec(list)?.[1];
  if (!ids) throw new Error('TEMPLATE_IDS not found in templates.ts');
  return new Map(
    [...ids.matchAll(/'([a-z0-9-]+)'/g)].map(([, id]) => [
      id,
      /modelSlug: '([a-z0-9-]+)'/.exec(readFileSync(join(TEMPLATES_DIR, `${id}.ts`), 'utf8'))?.[1],
    ]),
  );
}

function loadGifts(catalog) {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const templates = templateModels();
  const errors = [];
  const gifts = raw.gifts.map((entry, index) => {
    const at = `gifts[${index}] (${entry.templateId ?? '?'})`;
    const unknownKeys = Object.keys(entry).filter((key) => !GIFT_KEYS.has(key));
    if (unknownKeys.length) errors.push(`${at}: unknown key(s) ${unknownKeys.join(', ')}`);
    if (!templates.has(entry.templateId)) errors.push(`${at}: unknown templateId`);
    else if (templates.get(entry.templateId) !== entry.slug)
      errors.push(
        `${at}: the template shows ${templates.get(entry.templateId)}, not ${entry.slug}`,
      );
    const model = catalog.models.find((m) => m.slug === entry.slug);
    if (!model) {
      errors.push(`${at}: slug ${entry.slug} is not in models.manifest.json`);
      return null;
    }
    if (!(entry.sizeLimitKB > 0)) errors.push(`${at}: sizeLimitKB must be a positive number`);
    const maxTextureSize = entry.maxTextureSize ?? model.maxTextureSize;
    if (!Number.isInteger(maxTextureSize) || maxTextureSize < 128 || maxTextureSize > 2048)
      errors.push(`${at}: maxTextureSize must be an integer in 128..2048`);
    const { normalTextureSize } = entry;
    if (
      normalTextureSize !== undefined &&
      (!Number.isInteger(normalTextureSize) ||
        normalTextureSize < 128 ||
        normalTextureSize > maxTextureSize)
    )
      errors.push(`${at}: normalTextureSize must be an integer in 128..maxTextureSize`);
    const losslessNormals = entry.losslessNormals ?? model.losslessNormals;
    if (normalTextureSize !== undefined && !losslessNormals)
      errors.push(`${at}: normalTextureSize applies to lossless normal maps only`);
    const textureQuality = entry.textureQuality ?? catalog.textureQuality;
    if (!Number.isInteger(textureQuality) || textureQuality < 1 || textureQuality > 100)
      errors.push(`${at}: textureQuality must be an integer in 1..100`);
    if (entry.simplify) {
      const { ratio, error, flags = [], keepMaterials = [] } = entry.simplify;
      if (Object.keys(entry.simplify).some((key) => !SIMPLIFY_KEYS.has(key)))
        errors.push(`${at}: simplify takes ${[...SIMPLIFY_KEYS].join(', ')}`);
      if (!(ratio > 0 && ratio < 1) || !(error > 0))
        errors.push(`${at}: simplify needs ratio in (0, 1) and error > 0`);
      if (!Array.isArray(flags) || flags.some((flag) => !SIMPLIFY_FLAGS.has(flag)))
        errors.push(`${at}: simplify.flags must be of ${[...SIMPLIFY_FLAGS].join(', ')}`);
      if (
        !Array.isArray(keepMaterials) ||
        keepMaterials.some((name) => typeof name !== 'string' || !name)
      )
        errors.push(`${at}: simplify.keepMaterials must be an array of material names`);
      // optimize() would only warn and skip it; a hero gift states what it gets.
      if (readGlbJson(model.sourcePath).animations?.length)
        errors.push(`${at}: an animated model is never simplified`);
    }
    return {
      ...model,
      templateId: entry.templateId,
      sizeLimitKB: entry.sizeLimitKB,
      maxTextureSize,
      textureQuality,
      losslessNormals,
      normalTextureSize,
      stripUnlitNormals: entry.stripUnlitNormals ?? false,
      simplify: entry.simplify ?? false,
    };
  });
  if (errors.length) throw new Error(`Invalid hero.manifest.json:\n  ${errors.join('\n  ')}`);
  return {
    outputDir: resolve(HERO_DIR, raw.outputDir),
    publicPath: raw.publicPath,
    gifts,
  };
}

function printTable(rows) {
  const columns = [
    ['slug', 'slug'],
    ['kb', 'KB'],
    ['limitKb', 'limit KB'],
    ['sourceVertices', 'src verts'],
    ['vertices', 'verts'],
    ['triangles', 'tris'],
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

const catalog = loadManifest();
const { outputDir, publicPath, gifts } = loadGifts(catalog);
const io = await createIo();

const built = [];
for (const gift of gifts) {
  const started = performance.now();
  process.stdout.write(`building ${gift.slug} ... `);
  const glb = await optimize(io, gift, { textureQuality: gift.textureQuality });
  console.log(`${((performance.now() - started) / 1000).toFixed(1)} s`);
  const stats = await collectStats(io, gift, glb);
  const issues = [
    ...stats.problems,
    ...(stats.sizeBytes > gift.sizeLimitKB * 1024 ? [`over ${gift.sizeLimitKB} KB`] : []),
  ];
  built.push({
    gift,
    glb,
    stats,
    row: {
      ...stats,
      kb: (stats.sizeBytes / 1024).toFixed(1),
      limitKb: gift.sizeLimitKB,
      status: issues.length ? issues.join('; ') : 'ok',
    },
  });
}

printTable(built.map((b) => b.row));
const failed = built.filter((b) => b.row.status !== 'ok');
if (failed.length) {
  console.error(
    `\n${failed.length} gift(s) need attention, nothing written: ${failed.map((b) => b.gift.slug).join(', ')}`,
  );
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
const entries = [];
for (const { gift, glb, stats } of built) {
  const hash = createHash('sha256').update(glb).digest('hex').slice(0, 8);
  const fileName = `${gift.slug}.${hash}.glb`;
  const tmpPath = join(outputDir, `${fileName}.tmp`);
  writeFileSync(tmpPath, glb);
  renameSync(tmpPath, join(outputDir, fileName));
  entries.push({
    templateId: gift.templateId,
    slug: gift.slug,
    file: `${publicPath}/${fileName}`,
    bytes: stats.sizeBytes,
    triangles: stats.triangles,
    textures: stats.textures,
    maxTexturePx: stats.maxTexture,
    animations: stats.animationNames,
    credit: readCredit(readGlbJson(gift.sourcePath)),
    scene: Object.fromEntries(SCENE_KEYS.map((key) => [key, gift.scene[key]])),
  });
}
const keep = new Set(entries.map((entry) => entry.file.slice(publicPath.length + 1)));
for (const file of readdirSync(outputDir)) {
  if (HASHED_GIFT.test(file) && !keep.has(file)) rmSync(join(outputDir, file));
}
writeFileSync(GIFTS_JSON_PATH, `${JSON.stringify({ gifts: entries }, null, 2)}\n`);

const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`\ntotal: ${(total / 1024).toFixed(1)} KB in ${entries.length} gift(s)`);
console.log(`wrote ${GIFTS_JSON_PATH}`);
