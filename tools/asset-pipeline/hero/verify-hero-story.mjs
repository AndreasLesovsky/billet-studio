// Verifies the optimised hero story GLB (docs/hero-story.md) on its own and against the raw
// Blender export it was made from:
//   - the contract: scene extras.heroStory (a JSON string, validated like the runtime's
//     parseStoryMeta), required nodes, exactly one clip named heroStory.clip lasting
//     heroStory.duration, every Shadow_<Name> with its BLEND material M_Shadow_<Name>, the
//     16 x 16 placeholders the runtime replaces, TEXCOORD_0/1 where materials read them, the
//     Card_Spine skin, the Phone_ScreenDock extras, node names [A-Za-z0-9_]
//   - no KHR_materials_* extension (three.js would switch to MeshPhysicalMaterial)
//   - the Khronos glTF validator (no errors) and the size limit
//   - the poses: at sampled times, every animated node's world transform and every mesh's world
//     bounds (Card_Spine after skinning) of the optimised file match the raw export within
//     POSE_TOLERANCE_MM; the gift slot equals the dock at the end of the clip.
// Usage: node hero/verify-hero-story.mjs [optimised.glb]
//        (default: the file named in hero/hero-story.json; the raw export is always
//        tools/blender/hero/export/hero-story.glb)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MathUtils } from '@gltf-transform/core';
import validator from 'gltf-validator';
import { parseGlbJson } from '../models/lib/glb.mjs';
import { createIo } from '../models/lib/optimize.mjs';

const HERO_DIR = dirname(fileURLToPath(import.meta.url));
export const RAW_PATH = resolve(HERO_DIR, '../../blender/hero/export/hero-story.glb');
export const PUBLIC_DIR = resolve(HERO_DIR, '../../../billet-studio-frontend/public');
const TEMPLATES_PATH = resolve(
  HERO_DIR,
  '../../../billet-studio-frontend/src/app/billet/templates/templates.ts',
);
const MANIFEST_PATH = join(HERO_DIR, 'hero-story.json');

export const SIZE_LIMIT_KB = 600;
export const POSE_TOLERANCE_MM = 0.2;
const SAMPLE_STEP = 0.25;
const BEAT_IDS = ['write', 'gift', 'share'];
const TIME_EPSILON = 1e-3;
const REQUIRED_NODES = [
  'Cam',
  'CamTarget',
  'Card',
  'Card_Back',
  'Card_Front',
  'Card_Spine',
  'Card_Hinge',
  'GiftSlot',
  'Phone',
  'Phone_Body',
  'Phone_Screen',
  'Phone_ScreenDock',
  'Fx_Wake',
  'Fx_Notif',
  'Fx_Billet',
  'Fx_CardFade',
];
// Materials whose texture the runtime replaces: [material, texture slot]
export const PLACEHOLDER_SLOTS = [
  ['M_Print_Front', 'baseColorTexture'],
  ['M_Print_Inside', 'baseColorTexture'],
  ['M_Screen', 'emissiveTexture'],
];
const DOCK_EXTRAS = ['sceneRectDe', 'sceneRectEn', 'screenWidthM', 'screenHeightM', 'dockScale'];
const NAME = /^[A-Za-z0-9_]+$/;
const TEXTURE_SLOTS = [
  'baseColorTexture',
  'metallicRoughnessTexture',
  'normalTexture',
  'occlusionTexture',
  'emissiveTexture',
];

function templateIds() {
  const source = readFileSync(TEMPLATES_PATH, 'utf8');
  const ids = /export const TEMPLATE_IDS = \[([^\]]*)\]/.exec(source)?.[1];
  if (!ids) throw new Error('TEMPLATE_IDS not found in templates.ts');
  return [...ids.matchAll(/'([a-z0-9-]+)'/g)].map(([, id]) => id);
}

/** extras.heroStory, validated like hero-framing.ts parseStoryMeta (throws on the first problem). */
export function parseStoryMeta(raw) {
  if (typeof raw !== 'string') throw new Error('heroStory: missing (expected a JSON string)');
  const meta = JSON.parse(raw);
  const positive = (v, n) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
      throw new Error(`heroStory: ${n} must be a positive number`);
    return v;
  };
  const within = (v, n) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > meta.duration)
      throw new Error(`heroStory: ${n} must lie within the clip`);
    return v;
  };
  if (meta.version !== 1) throw new Error('heroStory: unsupported version');
  positive(meta.duration, 'duration');
  positive(meta.fps, 'fps');
  positive(meta.aspect, 'aspect');
  positive(meta.fovDeg, 'fovDeg');
  if (meta.fovDeg >= 180) throw new Error('heroStory: fovDeg must be below 180');
  if (typeof meta.clip !== 'string' || !meta.clip) throw new Error('heroStory: clip must be a name');
  if (!Array.isArray(meta.beats) || meta.beats.length !== BEAT_IDS.length)
    throw new Error(`heroStory: beats must list ${BEAT_IDS.join(', ')}`);
  let expected = 0;
  meta.beats.forEach((beat, i) => {
    if (beat.id !== BEAT_IDS[i]) throw new Error(`heroStory: beats[${i}] must be ${BEAT_IDS[i]}`);
    within(beat.start, `beats[${i}].start`);
    within(beat.end, `beats[${i}].end`);
    if (Math.abs(beat.start - expected) > TIME_EPSILON || beat.end <= beat.start)
      throw new Error(`heroStory: beats[${i}] does not follow on from the previous beat`);
    expected = beat.end;
  });
  if (Math.abs(expected - meta.duration) > TIME_EPSILON)
    throw new Error('heroStory: the last beat must end with the clip');
  within(meta.gates?.screens, 'gates.screens');
  within(meta.marks?.land, 'marks.land');
  if (!templateIds().includes(meta.gift?.templateId))
    throw new Error('heroStory: gift.templateId is not a template');
  return meta;
}

// ---- animation evaluation (LINEAR / STEP samplers, as exported) ------------------------------

function sampleSampler(sampler, t, path) {
  const input = sampler.getInput().getArray();
  const output = sampler.getOutput();
  const interpolation = sampler.getInterpolation();
  if (interpolation === 'CUBICSPLINE') throw new Error('CUBICSPLINE samplers are not expected');
  const last = input.length - 1;
  if (t <= input[0]) return output.getElement(0, []);
  if (t >= input[last]) return output.getElement(last, []);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (input[mid] <= t) lo = mid;
    else hi = mid;
  }
  const a = output.getElement(lo, []);
  if (interpolation === 'STEP') return a;
  const b = output.getElement(hi, []);
  const u = (t - input[lo]) / (input[hi] - input[lo]);
  if (path === 'rotation') return slerp(a, b, u);
  return a.map((v, i) => v + (b[i] - v) * u);
}

function slerp(a, b, u) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = dot < 0 ? b.map((v) => -v) : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const out = a.map((v, i) => v + (bb[i] - v) * u);
    const n = Math.hypot(...out);
    return out.map((v) => v / n);
  }
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - u) * theta) / s;
  const wb = Math.sin(u * theta) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}

function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function apply(m, v) {
  return [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
}

/** The document's clip channels: Map<Node, {translation?, rotation?, scale?}> of samplers. */
function channelMap(document) {
  const map = new Map();
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (!node) continue;
      if (!map.has(node)) map.set(node, {});
      map.get(node)[channel.getTargetPath()] = channel.getSampler();
    }
  }
  return map;
}

/** World matrices (column-major arrays) of every node at time t. */
function worldMatrices(document, channels, t) {
  const out = new Map();
  const visit = (node, parent) => {
    const ch = channels.get(node) ?? {};
    const tr = ch.translation ? sampleSampler(ch.translation, t, 'translation') : node.getTranslation();
    const ro = ch.rotation ? sampleSampler(ch.rotation, t, 'rotation') : node.getRotation();
    const sc = ch.scale ? sampleSampler(ch.scale, t, 'scale') : node.getScale();
    const local = MathUtils.compose(tr, ro, sc, new Array(16).fill(0));
    const world = parent ? mul(parent, local) : local;
    out.set(node, world);
    for (const child of node.listChildren()) visit(child, world);
  };
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  for (const node of scene.listChildren()) visit(node, null);
  return out;
}

/** The name a mesh node reports under: its own, or its parent's for an unnamed / *_Mesh child
 * (quantize() moves the mesh of an animated node into such a child). */
function meshKey(node) {
  const name = node.getName();
  const parent = node.getParentNode();
  if (parent && (!name || name === `${parent.getName()}_Mesh`)) return parent.getName();
  return name;
}

/** World-space bounds of every mesh (skinned meshes after skinning) at time t. */
function meshBounds(document, worlds) {
  const out = new Map();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    let jointMats = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      jointMats = skin.listJoints().map((joint, i) => mul(worlds.get(joint), ibm.getElement(i, [])));
    }
    const world = worlds.get(node);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      const p = [];
      const j = [];
      const w = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        let q;
        if (jointMats) {
          joints.getElement(i, j);
          weights.getElement(i, w);
          q = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            if (!w[k]) continue;
            const r = apply(jointMats[j[k]], p);
            for (let c = 0; c < 3; c++) q[c] += w[k] * r[c];
          }
        } else {
          q = apply(world, p);
        }
        for (let c = 0; c < 3; c++) {
          lo[c] = Math.min(lo[c], q[c]);
          hi[c] = Math.max(hi[c], q[c]);
        }
      }
    }
    const key = meshKey(node);
    const prev = out.get(key);
    out.set(
      key,
      prev
        ? [prev[0].map((v, c) => Math.min(v, lo[c])), prev[1].map((v, c) => Math.max(v, hi[c]))]
        : [lo, hi],
    );
  }
  return out;
}

function namedNodes(document) {
  return new Map(
    document
      .getRoot()
      .listNodes()
      .filter((n) => n.getName())
      .map((n) => [n.getName(), n]),
  );
}

/** Raw vs optimised: animated node transforms, mesh bounds, Fx values at sampled times. */
export function comparePoses(rawDocument, document, meta) {
  const times = new Set();
  for (let t = 0; t <= meta.duration + 1e-9; t += SAMPLE_STEP) times.add(Number(t.toFixed(4)));
  for (const beat of meta.beats) times.add(beat.start);
  times.add(meta.gates.screens).add(meta.marks.land).add(meta.duration);
  const rawChannels = channelMap(rawDocument);
  const optChannels = channelMap(document);
  const rawNodes = namedNodes(rawDocument);
  const optNodes = namedNodes(document);
  const animated = [...rawChannels.keys()].map((n) => n.getName());
  const worst = { nodeMm: 0, nodeDeg: 0, boundsMm: 0, fx: 0 };
  const where = {};
  for (const t of [...times].sort((a, b) => a - b)) {
    const rw = worldMatrices(rawDocument, rawChannels, t);
    const ow = worldMatrices(document, optChannels, t);
    for (const name of animated) {
      const a = rw.get(rawNodes.get(name));
      const b = ow.get(optNodes.get(name));
      if (!b) continue;
      const ta = [0, 0, 0];
      const tb = [0, 0, 0];
      const ra = [0, 0, 0, 1];
      const rb = [0, 0, 0, 1];
      const sa = [1, 1, 1];
      const sb = [1, 1, 1];
      MathUtils.decompose(a, ta, ra, sa);
      MathUtils.decompose(b, tb, rb, sb);
      const mm = Math.hypot(ta[0] - tb[0], ta[1] - tb[1], ta[2] - tb[2]) * 1000;
      const dot = Math.min(1, Math.abs(ra.reduce((s, v, i) => s + v * rb[i], 0)));
      const deg = (2 * Math.acos(dot) * 180) / Math.PI;
      if (mm > worst.nodeMm) (worst.nodeMm = mm), (where.nodeMm = `${name} @ ${t}s`);
      if (deg > worst.nodeDeg) (worst.nodeDeg = deg), (where.nodeDeg = `${name} @ ${t}s`);
      if (name.startsWith('Fx_')) {
        const lx = (m) => m[12];
        const d = Math.abs(lx(a) - lx(b));
        if (d > worst.fx) (worst.fx = d), (where.fx = `${name} @ ${t}s`);
      }
    }
    const rb = meshBounds(rawDocument, rw);
    const ob = meshBounds(document, ow);
    for (const [name, [lo, hi]] of rb) {
      const other = ob.get(name);
      if (!other) continue;
      const d =
        Math.max(...lo.map((v, c) => Math.abs(v - other[0][c])), ...hi.map((v, c) => Math.abs(v - other[1][c]))) *
        1000;
      if (d > worst.boundsMm) (worst.boundsMm = d), (where.boundsMm = `${name} @ ${t}s`);
    }
  }
  return { samples: times.size, worst, where };
}

/** GiftSlot's world transform vs Phone_ScreenDock's at the end of the clip. */
function landing(document, meta) {
  const worlds = worldMatrices(document, channelMap(document), meta.duration);
  const nodes = namedNodes(document);
  const a = worlds.get(nodes.get('GiftSlot'));
  const b = worlds.get(nodes.get('Phone_ScreenDock'));
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

/**
 * Checks the optimised GLB (`bytes`) against the contract and against the raw document.
 * Returns { problems: string[], report }.
 */
export async function verifyStory(io, rawDocument, bytes) {
  const problems = [];
  const expect = (ok, msg) => {
    if (!ok) problems.push(msg);
  };
  const document = await io.readBinary(bytes);
  const json = parseGlbJson(bytes);
  const root = document.getRoot();
  const report = { bytes: bytes.byteLength, kb: Number((bytes.byteLength / 1024).toFixed(1)) };

  let meta = null;
  try {
    meta = parseStoryMeta(root.getDefaultScene()?.getExtras()?.heroStory);
  } catch (error) {
    problems.push(String(error.message ?? error));
  }
  report.story = meta;

  const nodes = namedNodes(document);
  for (const name of REQUIRED_NODES) expect(nodes.has(name), `node ${name} missing`);
  const badNames = root
    .listNodes()
    .map((n) => n.getName())
    .filter((n) => !NAME.test(n));
  expect(!badNames.length, `node names outside [A-Za-z0-9_]: ${badNames.join(', ') || '(empty)'}`);

  const animations = root.listAnimations();
  report.animations = animations.map((a) => a.getName());
  if (meta) {
    expect(animations.length === 1 && animations[0].getName() === meta.clip, `exactly one clip named ${meta.clip}`);
    const end = Math.max(
      ...animations.flatMap((a) => a.listSamplers().map((s) => s.getInput().getMax([])[0])),
    );
    report.clipDuration = end;
    expect(Math.abs(end - meta.duration) < TIME_EPSILON, `clip lasts ${end} s, heroStory says ${meta.duration}`);
  }

  // shadows: Shadow_<Name> with M_Shadow_<Name> (BLEND); Fx_Shadow_<Name> needs its patch
  const shadowNames = [...nodes.keys()].filter((n) => /^Shadow_[A-Za-z0-9]+$/.test(n));
  report.shadows = shadowNames;
  for (const name of shadowNames) {
    const node = nodes.get(name);
    const meshNode = node.getMesh() ? node : node.listChildren().find((c) => c.getMesh());
    const mats = meshNode?.getMesh()?.listPrimitives().map((p) => p.getMaterial()) ?? [];
    expect(
      mats.length && mats.every((m) => m?.getName() === `M_${name}` && m.getAlphaMode() === 'BLEND'),
      `${name}: expected BLEND material M_${name}`,
    );
  }
  for (const name of nodes.keys()) {
    if (name.startsWith('Fx_Shadow_')) expect(nodes.has(name.slice(3)), `${name} without ${name.slice(3)}`);
  }

  // placeholders
  const materials = new Map(root.listMaterials().map((m) => [m.getName(), m]));
  for (const [matName, slot] of PLACEHOLDER_SLOTS) {
    const material = materials.get(matName);
    expect(material, `material ${matName} missing`);
    const getter = { baseColorTexture: 'getBaseColorTexture', emissiveTexture: 'getEmissiveTexture' }[slot];
    const texture = material?.[getter]();
    const size = texture?.getSize();
    expect(size && size[0] === 16 && size[1] === 16, `${matName}.${slot} is not a 16x16 placeholder`);
  }

  // texture coordinates every material reads exist; the ones the runtime needs are there
  const texcoords = {};
  for (const mat of json.materials ?? []) {
    const uses = new Set();
    const pbr = mat.pbrMetallicRoughness ?? {};
    for (const slot of TEXTURE_SLOTS) {
      const info = pbr[slot] ?? mat[slot];
      if (info) uses.add(info.texCoord ?? 0);
    }
    texcoords[mat.name] = [...uses];
  }
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const matName = json.materials?.[prim.material]?.name;
      for (const uv of texcoords[matName] ?? []) {
        expect(`TEXCOORD_${uv}` in prim.attributes, `${mesh.name}: ${matName} reads TEXCOORD_${uv}, missing`);
      }
    }
  }
  const attrs = (name) => {
    const node = nodes.get(name);
    const meshNode = node?.getMesh() ? node : node?.listChildren().find((c) => c.getMesh());
    return new Set(meshNode?.getMesh()?.listPrimitives().flatMap((p) => p.listSemantics()) ?? []);
  };
  for (const name of ['Card_Back', 'Card_Front', 'Card_Spine', 'Phone_Screen', ...shadowNames])
    expect(attrs(name).has('TEXCOORD_0'), `${name} without TEXCOORD_0`);
  expect(attrs('Phone_Body').has('TEXCOORD_1'), 'Phone_Body without TEXCOORD_1 (occlusion)');

  // extensions
  const used = json.extensionsUsed ?? [];
  report.extensionsUsed = used;
  const physical = used.filter((e) => e.startsWith('KHR_materials_'));
  expect(!physical.length, `KHR_materials_* extensions present: ${physical.join(', ')}`);

  // skin
  const spine = nodes.get('Card_Spine');
  const joints = spine?.getSkin()?.listJoints().map((j) => j.getName()) ?? [];
  report.skinJoints = joints.length;
  expect(
    joints.length === 17 && joints.every((n, i) => n === `Spine_${String(i).padStart(2, '0')}`),
    'Card_Spine skin: joints Spine_00..Spine_16 expected',
  );
  expect(attrs('Card_Spine').has('JOINTS_0') && attrs('Card_Spine').has('WEIGHTS_0'), 'Card_Spine without JOINTS_0 / WEIGHTS_0');

  // dock extras
  const dockExtras = nodes.get('Phone_ScreenDock')?.getExtras() ?? {};
  for (const key of DOCK_EXTRAS) expect(key in dockExtras, `Phone_ScreenDock extras: ${key} missing`);

  // size, validator
  expect(bytes.byteLength <= SIZE_LIMIT_KB * 1024, `${report.kb} KB > ${SIZE_LIMIT_KB} KB`);
  const validation = await validator.validateBytes(new Uint8Array(bytes), {
    maxIssues: 50,
    ignoredIssues: ['UNUSED_OBJECT'],
  });
  report.validator = {
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
    messages: validation.issues.messages
      .filter((m) => m.severity <= 1)
      .slice(0, 10)
      .map((m) => `${m.code} ${m.pointer ?? ''} ${m.message}`),
  };
  expect(validation.issues.numErrors === 0, `glTF validator: ${validation.issues.numErrors} error(s)`);

  // poses and landing
  if (meta) {
    const poses = comparePoses(rawDocument, document, meta);
    report.poses = poses;
    expect(
      poses.worst.nodeMm <= POSE_TOLERANCE_MM && poses.worst.boundsMm <= POSE_TOLERANCE_MM,
      `poses differ from the raw export by ${poses.worst.nodeMm.toFixed(3)} mm (nodes) / ` +
        `${poses.worst.boundsMm.toFixed(3)} mm (mesh bounds), limit ${POSE_TOLERANCE_MM} mm`,
    );
    expect(poses.worst.fx <= 1e-3, `Fx values differ by ${poses.worst.fx}`);
    report.landingMaxMatrixDiff = landing(document, meta);
    expect(report.landingMaxMatrixDiff < 1e-5, 'GiftSlot != Phone_ScreenDock at the end of the clip');
  }
  report.nodes = [...nodes.keys()];
  report.triangles = root
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  return { problems, report };
}

async function main() {
  const target =
    process.argv[2] ??
    join(PUBLIC_DIR, JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).file);
  const io = await createIo();
  const rawDocument = await io.read(RAW_PATH);
  const { problems, report } = await verifyStory(io, rawDocument, readFileSync(target));
  console.log(
    `${target}: ${report.kb} KB, ${report.triangles} triangles, poses max ` +
      `${report.poses?.worst.nodeMm.toFixed(4)} mm / ${report.poses?.worst.boundsMm.toFixed(4)} mm, ` +
      `validator ${report.validator.errors} error(s) ${report.validator.warnings} warning(s)`,
  );
  if (problems.length) {
    console.error(`Problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('ok');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
