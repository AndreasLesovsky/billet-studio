import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODELS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(MODELS_DIR, 'models.manifest.json');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OCCASION_PATTERN = /^[a-z][a-z_]*$/;
const SCENE_KEYS = [
  'fitSize',
  'yOffset',
  'exposure',
  'cameraDistance',
  'cameraHeight',
  'autoRotateSpeed',
];
// DECIMAL(4,2) columns in tbl_models.
const DECIMAL_LIMIT = 99.99;
const MAX_TEXTURE_SIZE = 2048;

export function loadManifest() {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const sourceDir = resolve(
    process.env.BILLET_MODELS_SOURCE_DIR ?? resolve(MODELS_DIR, raw.sourceDir),
  );
  const outputDir = resolve(MODELS_DIR, raw.outputDir);
  const errors = [];
  const seenSlugs = new Set();
  const seenSources = new Set();

  const models = raw.models.map((entry, index) => {
    const at = `models[${index}] (${entry.slug ?? '?'})`;
    if (!SLUG_PATTERN.test(entry.slug ?? '') || entry.slug.length > 60)
      errors.push(`${at}: invalid slug`);
    if (seenSlugs.has(entry.slug)) errors.push(`${at}: duplicate slug`);
    seenSlugs.add(entry.slug);
    if (seenSources.has(entry.source)) errors.push(`${at}: duplicate source`);
    seenSources.add(entry.source);
    if (!Number.isInteger(entry.version) || entry.version < 1)
      errors.push(`${at}: version must be an integer >= 1`);
    for (const key of ['name_de', 'name_en']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim() || entry[key].length > 100)
        errors.push(`${at}: invalid ${key}`);
    }
    if (!OCCASION_PATTERN.test(entry.occasion ?? '') || entry.occasion.length > 30)
      errors.push(`${at}: invalid occasion`);
    if (typeof entry.active !== 'boolean') errors.push(`${at}: active must be boolean`);
    if (!Number.isInteger(entry.position) || entry.position < 0 || entry.position > 65535)
      errors.push(`${at}: invalid position`);
    if (
      !Number.isInteger(entry.maxTextureSize) ||
      entry.maxTextureSize < 256 ||
      entry.maxTextureSize > MAX_TEXTURE_SIZE
    ) {
      errors.push(`${at}: maxTextureSize must be an integer in 256..${MAX_TEXTURE_SIZE}`);
    }
    for (const key of SCENE_KEYS) {
      const value = entry.scene?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > DECIMAL_LIMIT)
        errors.push(`${at}: invalid scene.${key}`);
    }
    if (!(entry.scene?.fitSize > 0 && entry.scene.fitSize <= 5))
      errors.push(`${at}: scene.fitSize must be in (0, 5]`);
    if (entry.sizeLimitMB !== undefined && !(entry.sizeLimitMB > 0))
      errors.push(`${at}: sizeLimitMB must be a positive number`);
    if (entry.previewRotationY !== undefined && !Number.isFinite(entry.previewRotationY))
      errors.push(`${at}: previewRotationY must be a number`);
    if (entry.losslessNormals !== undefined && typeof entry.losslessNormals !== 'boolean')
      errors.push(`${at}: losslessNormals must be boolean`);
    const excluded = entry.excludeMaterials ?? [];
    if (!Array.isArray(excluded) || excluded.some((name) => typeof name !== 'string'))
      errors.push(`${at}: excludeMaterials must be a string array`);

    const fileName = `${entry.slug}.v${entry.version}.glb`;
    const previewName = `${entry.slug}.v${entry.version}.webp`;
    return {
      ...entry,
      simplify: entry.simplify ?? false,
      excludeMaterials: entry.excludeMaterials ?? [],
      losslessNormals: entry.losslessNormals ?? false,
      sourcePath: join(sourceDir, entry.source),
      fileName,
      outputPath: join(outputDir, fileName),
      previewPath: join(outputDir, 'previews', previewName),
      // Relative to app.models.base-url (the frontend origin root), hence the models/ prefix.
      relativeFilePath: `models/${fileName}`,
      relativePreviewPath: `models/previews/${previewName}`,
    };
  });

  for (const model of models) {
    if (!existsSync(model.sourcePath))
      errors.push(`${model.slug}: source not found: ${model.sourcePath}`);
  }
  if (errors.length) throw new Error(`Invalid models.manifest.json:\n  ${errors.join('\n  ')}`);

  return {
    sourceDir,
    outputDir,
    textureQuality: raw.textureQuality,
    previewRotationY: raw.previewRotationY,
    models,
  };
}

/** Parses `--force`, `--compare` and `--only=slug-a,slug-b`. */
export function parseArgs(argv = process.argv.slice(2)) {
  const only = argv
    .find((arg) => arg.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .filter(Boolean);
  return {
    force: argv.includes('--force'),
    compare: argv.includes('--compare'),
    only: only?.length ? new Set(only) : null,
  };
}

export function selectModels(models, only) {
  if (!only) return models;
  const unknown = [...only].filter((slug) => !models.some((m) => m.slug === slug));
  if (unknown.length) throw new Error(`Unknown slug(s): ${unknown.join(', ')}`);
  return models.filter((m) => only.has(m.slug));
}

export const mb = (bytes) => (bytes / 1048576).toFixed(2);
