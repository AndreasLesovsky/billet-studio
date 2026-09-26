// Optimises the story GLB exported by Blender (tools/blender/hero/export/hero-story.glb, see
// docs/hero-story.md) for the home page's 3D hero with a chain that keeps the story's structure:
//   dedup (accessors, meshes, textures only - never materials: the runtime finds them by name)
//   weld, resample (lossless within RESAMPLE_TOLERANCE), 16 x 16 placeholders in the slots the
//   runtime replaces (M_Print_Front, M_Print_Inside base colour, M_Screen emissive), BLEND on
//   M_Shadow_*, WebP textures (per slot, see TEXTURES), prune (keeping empty leaves such as Cam,
//   Fx_* and GiftSlot, unused attributes, extras and the solid-colour placeholders), meshopt
//   (level medium: positions 14 / normals 10 / UVs 12 bit, animation data lossless) - no flatten,
//   join, instance or simplify.
// quantize() moves the mesh of an animated node (the card's shadow patches follow its turn) into a
// child node; that child is named <Node>_Mesh.
// The result is verified (verify-hero-story.mjs: contract, validator, size, poses vs the raw
// export); only then it is written:
//   billet-studio-frontend/public/hero/story.<hash8>.glb   content-hashed, stale ones removed
//   hero/hero-story.json                                    file, bytes, triangles, story meta,
//                                                           nodes, textures, verify summary
// Exit 1, writing nothing, on any problem.
// Usage: npm run hero:story
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PropertyType } from '@gltf-transform/core';
import { dedup, meshopt, prune, resample, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { createIo } from '../models/lib/optimize.mjs';
import { PLACEHOLDER_SLOTS, PUBLIC_DIR, RAW_PATH, verifyStory } from './verify-hero-story.mjs';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(PUBLIC_DIR, 'hero');
const MANIFEST_PATH = join(HERO_DIR, 'hero-story.json');
const STORY_FILE = /^story\.[0-9a-f]{8}\.glb$/;
// Absolute, per component (metres, quaternion components, Fx values): far below what shows.
const RESAMPLE_TOLERANCE = 1e-5;
const PLACEHOLDER_RGB = { r: 246, g: 242, b: 234 };
// WebP per texture slot / name. The paper normal map carries 1-6 mm cockle and 0.2-0.6 mm mottle
// at 60 mm per tile; at hero scale (a card is a few hundred pixels tall) 256 px keeps both.
const TEXTURES = [
  { name: 'placeholders', pattern: /^placeholder_/, lossless: true },
  { name: 'paper normal', slots: /^normalTexture$/, resize: [256, 256], quality: 92 },
  { name: 'phone AO', slots: /^occlusionTexture$/, resize: [512, 512], quality: 88 },
  { name: 'shadows', pattern: /^shadow_/, resize: [256, 256], quality: 90 },
];

/** A 16 x 16 PNG (paper colour for the prints, black for the screen). */
async function placeholderPng(rgb) {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: rgb } }).png().toBuffer();
}

async function setPlaceholders(document) {
  const materials = new Map(document.getRoot().listMaterials().map((m) => [m.getName(), m]));
  for (const [matName, slot] of PLACEHOLDER_SLOTS) {
    const material = materials.get(matName);
    if (!material) throw new Error(`material ${matName} missing`);
    const texture =
      slot === 'baseColorTexture' ? material.getBaseColorTexture() : material.getEmissiveTexture();
    if (!texture) throw new Error(`${matName}.${slot} has no texture`);
    const rgb = matName === 'M_Screen' ? { r: 0, g: 0, b: 0 } : PLACEHOLDER_RGB;
    texture
      .setImage(await placeholderPng(rgb))
      .setMimeType('image/png')
      .setName(`placeholder_${matName}`)
      .setURI('');
  }
}

function forceShadowBlend(document) {
  const shadows = document
    .getRoot()
    .listMaterials()
    .filter((m) => m.getName().startsWith('M_Shadow_'));
  if (!shadows.length) throw new Error('no M_Shadow_* material');
  for (const material of shadows) material.setAlphaMode('BLEND');
  return shadows.map((m) => m.getName());
}

/** Names the child nodes quantize() created for the meshes of animated nodes. */
function nameMeshChildren(document) {
  const named = [];
  for (const node of document.getRoot().listNodes()) {
    const parent = node.getParentNode();
    if (!node.getName() && node.getMesh() && parent?.getName()) {
      node.setName(`${parent.getName()}_Mesh`);
      named.push(node.getName());
    }
  }
  return named;
}

function textureTransforms() {
  return TEXTURES.map(({ pattern, slots, resize, quality, lossless }) =>
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      ...(pattern ? { pattern } : {}),
      ...(slots ? { slots } : {}),
      ...(resize ? { resize } : {}),
      ...(quality ? { quality } : {}),
      ...(lossless ? { lossless: true } : {}),
      effort: 6,
    }),
  );
}

async function main() {
  const io = await createIo();
  const rawBytes = readFileSync(RAW_PATH);
  const rawDocument = await io.read(RAW_PATH);
  const document = await io.read(RAW_PATH);

  await setPlaceholders(document);
  const blend = forceShadowBlend(document);
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    weld(),
    resample({ tolerance: RESAMPLE_TOLERANCE }),
    ...textureTransforms(),
    prune({
      keepLeaves: true,
      keepAttributes: true,
      keepExtras: true,
      keepIndices: true,
      keepSolidTextures: true,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const meshChildren = nameMeshChildren(document);
  const nonWebp = document
    .getRoot()
    .listTextures()
    .filter((t) => t.getMimeType() !== 'image/webp')
    .map((t) => t.getName());
  const glb = await io.writeBinary(document);

  const { problems, report } = await verifyStory(io, rawDocument, glb);
  if (nonWebp.length) problems.push(`textures not WebP: ${nonWebp.join(', ')}`);
  const textures = document
    .getRoot()
    .listTextures()
    .map((t) => ({
      name: t.getName(),
      size: t.getSize(),
      bytes: t.getImage()?.byteLength ?? 0,
      mimeType: t.getMimeType(),
    }));
  console.log(
    `story: ${(rawBytes.byteLength / 1024).toFixed(0)} KB raw -> ${report.kb} KB, ` +
      `${report.triangles} triangles, ${textures.length} textures ` +
      `(${(textures.reduce((s, t) => s + t.bytes, 0) / 1024).toFixed(1)} KB)`,
  );
  if (report.poses) {
    const { worst, where } = report.poses;
    console.log(
      `  poses vs raw: nodes ${worst.nodeMm.toFixed(4)} mm (${where.nodeMm ?? '-'}), ` +
        `${worst.nodeDeg.toFixed(4)} deg; mesh bounds ${worst.boundsMm.toFixed(4)} mm ` +
        `(${where.boundsMm ?? '-'}); Fx ${worst.fx.toExponential(2)}`,
    );
  }
  console.log(
    `  validator: ${report.validator.errors} error(s), ${report.validator.warnings} warning(s)`,
  );
  for (const m of report.validator.messages) console.log(`    ${m}`);
  if (problems.length) {
    console.error(`Hero story NOT written:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const hash = createHash('sha256').update(glb).digest('hex').slice(0, 8);
  const fileName = `story.${hash}.glb`;
  const outPath = join(OUTPUT_DIR, fileName);
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, glb);
  renameSync(tmp, outPath);
  for (const file of readdirSync(OUTPUT_DIR)) {
    if (STORY_FILE.test(file) && file !== fileName) {
      rmSync(join(OUTPUT_DIR, file));
      console.log(`  removed stale ${file}`);
    }
  }
  const manifest = {
    file: `hero/${fileName}`,
    bytes: glb.byteLength,
    triangles: report.triangles,
    source: relative(join(HERO_DIR, '..', '..', '..'), RAW_PATH).replaceAll('\\', '/'),
    sourceBytes: rawBytes.byteLength,
    sourceSha256: createHash('sha256').update(rawBytes).digest('hex'),
    story: report.story,
    nodes: report.nodes,
    shadows: report.shadows,
    meshChildren,
    blendMaterials: blend,
    textures,
    extensionsUsed: report.extensionsUsed,
    verify: {
      sizeLimitKB: 600,
      poseToleranceMm: 0.2,
      poses: report.poses,
      landingMaxMatrixDiff: report.landingMaxMatrixDiff,
      validator: { errors: report.validator.errors, warnings: report.validator.warnings },
    },
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${outPath}\n      ${MANIFEST_PATH}`);
}

await main();
