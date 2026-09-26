// The GLB transform list, its verification and the output statistics, shared by the catalog
// (models/optimize-models.mjs) and the hero gifts (hero/build-hero-gifts.mjs).
import { statSync } from 'node:fs';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  createTransform,
  dedup,
  flatten,
  getSceneVertexCount,
  instance,
  join,
  meshopt,
  prune,
  resample,
  simplify,
  simplifyPrimitive,
  textureCompress,
  VertexCountMethod,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { parseGlbJson, readGlbJson } from './glb.mjs';
import { mb } from './manifest.mjs';

// Simplification is refused below this vertex count or for animated models.
const SIMPLIFY_MIN_VERTICES = 20000;
// Lossy WebP subsamples chroma (4:2:0), which blurs the X/Y vectors a normal map stores in R/G.
const NORMAL_SLOT = /^normalTexture$/;
const NOT_NORMAL_SLOT = /^(?!normalTexture$)/;
const TRIANGLES = 4;
// Draw modes simplifyPrimitive() handles (POINTS, TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN).
const SIMPLIFIABLE_MODES = new Set([0, 4, 5, 6]);

export async function createIo() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
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
  const { ratio = 0.5, error = 0.001, flags = [], keepMaterials = [] } = model.simplify;
  // gltf-transform passes only LockBorder; extra meshoptimizer flags (Prune, Permissive) go in here.
  const simplifier = flags.length
    ? {
        ...MeshoptSimplifier,
        simplify: (indices, positions, stride, target, targetError, baseFlags) =>
          MeshoptSimplifier.simplify(indices, positions, stride, target, targetError, [
            ...baseFlags,
            ...flags,
          ]),
      }
    : MeshoptSimplifier;
  const options = { simplifier, ratio, error, lockBorder: true };
  if (!keepMaterials.length) return [simplify(options)];
  return [simplifyExcept(model.slug, options, new Set(keepMaterials))];
}

/**
 * simplify() that leaves the primitives drawn with the keepMaterials untouched (thin parts such as
 * stems, whose cylinders collapse into prisms with distorted UVs at a scan's ratio). Same steps as
 * the gltf-transform transform otherwise; the stock one stays in use without keepMaterials, so the
 * catalog output does not change.
 */
function simplifyExcept(slug, options, keepMaterials) {
  return createTransform('simplifyExcept', async (document) => {
    await document.transform(weld({ overwrite: false }));
    const kept = new Set();
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const material = primitive.getMaterial()?.getName();
        if (keepMaterials.has(material)) {
          kept.add(material);
          continue;
        }
        if (!SIMPLIFIABLE_MODES.has(primitive.getMode())) continue;
        simplifyPrimitive(primitive, options);
        if (!primitive.getIndices()?.getCount()) primitive.dispose();
      }
      if (!mesh.listPrimitives().length) mesh.dispose();
    }
    const unknown = [...keepMaterials].filter((name) => !kept.has(name));
    if (unknown.length)
      throw new Error(`${slug}: simplify.keepMaterials not found: ${unknown.join(', ')}`);
    console.log(`  ${slug}: not simplified: ${[...kept].join(', ')}`);
  });
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

/**
 * Forces the named materials opaque (alphaMode OPAQUE, base colour alpha 1). For a BLEND material
 * that is not meant to be see-through: over the billet's transparent canvas it lets the page show
 * through and, double-sided, the back faces (a mirrored label) as well.
 */
function makeOpaque(model, document) {
  if (!model.opaqueMaterials.length) return;
  const names = new Set(model.opaqueMaterials);
  const materials = document
    .getRoot()
    .listMaterials()
    .filter((material) => names.has(material.getName()));
  const found = new Set(materials.map((material) => material.getName()));
  const unknown = [...names].filter((name) => !found.has(name));
  if (unknown.length)
    throw new Error(`${model.slug}: opaqueMaterials not found: ${unknown.join(', ')}`);
  for (const material of materials) {
    const [r, g, b] = material.getBaseColorFactor();
    material.setAlphaMode('OPAQUE').setBaseColorFactor([r, g, b, 1]);
  }
  console.log(`  ${model.slug}: made opaque: ${[...found].join(', ')}`);
}

/**
 * Removes NORMAL from primitives whose material is KHR_materials_unlit (three.js draws those with
 * MeshBasicMaterial, which never reads it). Split normals keep weld() from merging vertices and
 * simplify() from collapsing them, so this is what makes an unlit scan simplifiable.
 */
function stripUnlitNormals(model, document) {
  if (!model.stripUnlitNormals) return;
  let stripped = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const unlit = primitive.getMaterial()?.getExtension('KHR_materials_unlit');
      const normal = primitive.getAttribute('NORMAL');
      if (!unlit || !normal) continue;
      primitive.setAttribute('NORMAL', null);
      if (!normal.listParents().some((parent) => parent !== document.getRoot())) normal.dispose();
      stripped++;
    }
  }
  if (!stripped) throw new Error(`${model.slug}: stripUnlitNormals found no unlit primitive`);
  console.log(`  ${model.slug}: removed NORMAL from ${stripped} unlit primitive(s)`);
}

/**
 * WebP at textureQuality; with losslessNormals, a second pass encodes normal maps lossless, at
 * normalTextureSize when set (lossless costs ~10x lossy per pixel).
 */
function textureTransforms(model, textureQuality) {
  const options = {
    encoder: sharp,
    targetFormat: 'webp',
    quality: textureQuality,
    resize: [model.maxTextureSize, model.maxTextureSize],
  };
  if (!model.losslessNormals) return [textureCompress(options)];
  const normalSize = model.normalTextureSize ?? model.maxTextureSize;
  return [
    textureCompress({ ...options, slots: NOT_NORMAL_SLOT }),
    textureCompress({
      ...options,
      slots: NORMAL_SLOT,
      lossless: true,
      resize: [normalSize, normalSize],
    }),
  ];
}

/**
 * Optimizes model.sourcePath and returns the GLB bytes. `model` carries slug, sourcePath,
 * maxTextureSize, simplify, excludeMaterials, opaqueMaterials, losslessNormals and optionally
 * stripUnlitNormals and normalTextureSize (hero-only so far; optimize-models.mjs puts them into its
 * settings key once set); `extras` is merged into asset.extras.
 */
export async function optimize(io, model, { textureQuality, extras = {} }) {
  const document = await io.read(model.sourcePath);
  excludeMaterials(model, document);
  makeOpaque(model, document);
  stripUnlitNormals(model, document);

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
    ...textureTransforms(model, textureQuality),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  const asset = document.getRoot().getAsset();
  asset.extras = { ...asset.extras, ...extras };
  return io.writeBinary(document);
}

/** Fails loudly if an animation or a source extension (unlit, emissive, ...) did not survive. */
export function verify(sourceJson, outputJson, outputDocument) {
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

/** Draw calls and triangles as rendered: an EXT_mesh_gpu_instancing node is one draw per primitive. */
function countDraws(scene) {
  let drawCalls = 0;
  let triangles = 0;
  scene.traverse((node) => {
    const primitives = node.getMesh()?.listPrimitives() ?? [];
    const instances =
      node.getExtension('EXT_mesh_gpu_instancing')?.listAttributes()[0]?.getCount() ?? 1;
    drawCalls += primitives.length;
    for (const primitive of primitives) {
      if (primitive.getMode() !== TRIANGLES) continue;
      const count =
        primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += (count / 3) * instances;
    }
  });
  return { drawCalls, triangles };
}

/** Statistics and verify() problems of an optimized GLB (`glb`: its bytes) against its source. */
export async function collectStats(io, model, glb) {
  const outputDocument = await io.readBinary(glb);
  const outputJson = parseGlbJson(glb);
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
  return {
    slug: model.slug,
    sourceMb: mb(statSync(model.sourcePath).size),
    sizeBytes: glb.byteLength,
    outputMb: mb(glb.byteLength),
    sourceVertices,
    vertices: getSceneVertexCount(scene, VertexCountMethod.UPLOAD),
    textures: textures.length,
    maxTexture: Math.max(0, ...textures.map((t) => Math.max(...(t.getSize() ?? [0, 0])))),
    ...countDraws(scene),
    animations: root.listAnimations().length,
    animationNames: root.listAnimations().map((animation) => animation.getName()),
    problems: verify(sourceJson, outputJson, outputDocument),
  };
}
