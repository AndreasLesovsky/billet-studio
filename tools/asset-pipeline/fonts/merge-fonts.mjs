// Builds the billet font library from fonts.manifest.json: merges the local font folders,
// downloads the Google Fonts families the manifest names, and writes public/fonts (woff2,
// fonts.css, LICENSES.md), font-catalog.generated.ts and preview.html.
//
//   node merge-fonts.mjs          build, then verify
//   node merge-fonts.mjs --force  build and download every Google Fonts file again
//   node merge-fonts.mjs --check  verify the current outputs only (no network, no writes)
//
// Source folders are read-only: files are only ever read or copied out of them.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOutputs } from './lib/check.mjs';
import {
  normalizeRange,
  parseFontFaces,
  subsetOfCodepoints,
  subsetOfRange,
  weightLabel,
} from './lib/css.mjs';
import {
  renderCatalog,
  renderFontsCss,
  renderLicenses,
  renderPreview,
  sortFamilies,
} from './lib/emit.mjs';
import { downloadBinary, familyQuery, fetchGoogleFaces } from './lib/google-fonts.mjs';
import { inspectWoff2 } from './lib/woff2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const manifest = JSON.parse(readFileSync(join(HERE, 'fonts.manifest.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');

const fontsDir = resolve(REPO, manifest.outputs.fontsDir);
const catalogPath = resolve(REPO, manifest.outputs.catalog);
const previewPath = resolve(REPO, manifest.outputs.preview);
const lockPath = resolve(REPO, manifest.outputs.lock);
const GOOGLE_ID = 'google';

const warnings = [];
const repairs = [];
const skipped = [];
const inspected = new Map();

const kebab = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

function familyConfig(family) {
  const config = manifest.families[family];
  if (!config) {
    throw new Error(
      `'${family}' is not listed in fonts.manifest.json "families" (category needed)`,
    );
  }
  return config;
}

function inspect(file) {
  if (!inspected.has(file)) {
    const buf = readFileSync(file);
    inspected.set(file, { ...inspectWoff2(buf), bytes: buf.length, sha: sha256(buf) });
  }
  return inspected.get(file);
}

function destName(id, face) {
  const w =
    face.weight.min === face.weight.max ? face.weight.min : `${face.weight.min}-${face.weight.max}`;
  return `${id}/${id}-${face.subset}-${w}${face.style === 'italic' ? 'italic' : ''}.woff2`;
}

function collectLocal() {
  const candidates = [];
  manifest.sources.forEach((source, order) => {
    const root = resolve(REPO, source.dir);
    if (!existsSync(root)) {
      warnings.push(`source ${source.label} not found at ${root}, skipped`);
      return;
    }
    for (const folder of readdirSync(root).sort()) {
      const folderPath = join(root, folder);
      if (!statSync(folderPath).isDirectory()) continue;
      for (const cssName of readdirSync(folderPath).filter((n) => n.endsWith('.css'))) {
        for (const face of parseFontFaces(readFileSync(join(folderPath, cssName), 'utf8'))) {
          if (source.families && !source.families.includes(face.family)) continue;
          const config = familyConfig(face.family);
          if (config.exclude) continue;
          const where = `${source.label}/${folder}/${cssName}`;
          if (!face.url || !face.url.endsWith('.woff2')) {
            warnings.push(`${where}: ${face.family} face without a woff2 url, skipped`);
            continue;
          }
          let file = resolve(folderPath, face.url);
          if (!existsSync(file)) {
            file = join(folderPath, basename(face.url));
            if (!existsSync(file)) {
              warnings.push(`${where}: ${face.url} not found, skipped`);
              continue;
            }
            repairs.push(`${where}: url('${face.url}') -> ${basename(face.url)}`);
          }
          const meta = inspect(file);
          const subset = face.unicodeRange
            ? subsetOfRange(face.unicodeRange)
            : subsetOfCodepoints(meta.codepoints);
          if (subset === 'other') {
            skipped.push(
              `${where}: ${face.family} ${face.style} ${weightLabel(face.weight)} ${basename(file)}`,
            );
            continue;
          }
          candidates.push({
            family: face.family,
            style: face.style,
            weight: face.weight,
            subset,
            unicodeRange: face.unicodeRange ?? manifest.unicodeRanges[subset] ?? null,
            file,
            sourceId: source.id,
            sourceLabel: source.label,
            order,
            codepoints: meta.codepoints.size,
          });
        }
      }
    }
  });
  return candidates;
}

function readLock() {
  return existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : { google: {} };
}

async function collectGoogle(lock) {
  const candidates = [];
  const downloads = [];
  for (const [family, config] of Object.entries(manifest.families)) {
    if (!config.download || config.exclude) continue;
    const id = config.id ?? kebab(family);
    const query = familyQuery(family, config.download);
    const cached = lock.google[family];
    const cacheValid =
      !FORCE &&
      cached?.query === query &&
      cached.faces.every((f) => {
        const file = join(fontsDir, f.file);
        return existsSync(file) && inspect(file).sha === f.sha256;
      });
    let faces = cached?.faces ?? [];
    if (!cacheValid) {
      const fetched = await fetchGoogleFaces(query, manifest.google, manifest.subsets);
      faces = [];
      for (const face of fetched) {
        const rel = destName(id, face);
        const file = join(fontsDir, rel);
        const previous = cached?.faces.find((f) => f.file === rel && f.url === face.url);
        const reusable =
          !FORCE && previous && existsSync(file) && inspect(file).sha === previous.sha256;
        if (!reusable) {
          const buf = await downloadBinary(face.url);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, buf);
          inspected.delete(file);
          downloads.push(rel);
        }
        faces.push({ ...face, file: rel, sha256: inspect(file).sha, bytes: inspect(file).bytes });
      }
      lock.google[family] = { query, faces };
    }
    for (const style of ['normal', 'italic']) {
      const wanted =
        style === 'normal' ? config.download.weights : (config.download.italicWeights ?? []);
      for (const w of wanted) {
        const served = faces.some(
          (f) => f.style === style && f.weight.min <= w && f.weight.max >= w,
        );
        if (!served) throw new Error(`Google Fonts did not serve ${family} ${style} ${w}`);
      }
    }
    for (const face of faces) {
      const file = join(fontsDir, face.file);
      candidates.push({
        family,
        style: face.style,
        weight: face.weight,
        subset: face.subset,
        unicodeRange: normalizeRange(face.unicodeRange),
        file,
        sourceId: GOOGLE_ID,
        sourceLabel: manifest.google.label,
        order: -1,
        codepoints: inspect(file).codepoints.size,
      });
    }
  }
  return { candidates, downloads };
}

function selectFaces(candidates) {
  const byFamily = Map.groupBy(candidates, (c) => c.family);
  const families = [];
  for (const [family, list] of byFamily) {
    const config = familyConfig(family);
    const variants = new Map();
    for (const c of list) {
      const key = `${c.sourceId}|${c.style}|${c.weight.min}|${c.weight.max}`;
      const variant = variants.get(key) ?? { ...c, subsets: new Map() };
      const existing = variant.subsets.get(c.subset);
      if (!existing || existing.codepoints < c.codepoints) variant.subsets.set(c.subset, c);
      variants.set(key, variant);
    }
    const usable = [...variants.values()].filter((v) => {
      const ok = v.subsets.has('latin') || v.subsets.has('all');
      if (!ok) {
        warnings.push(
          `${family} ${v.style} ${weightLabel(v.weight)} from ${v.sourceLabel}: no latin coverage, dropped`,
        );
      }
      return ok;
    });
    const perSource = new Map();
    for (const v of usable) perSource.set(v.sourceId, (perSource.get(v.sourceId) ?? 0) + 1);
    // Coverage first (variable > static, latin-ext > latin), then the source that supplies the
    // most faces, so a family stays within one build wherever possible.
    const score = (v) =>
      (v.weight.min !== v.weight.max ? 4 : 0) +
      (v.subsets.has('latin-ext') || v.subsets.has('all') ? 2 : 0);
    usable.sort(
      (a, b) =>
        score(b) - score(a) ||
        perSource.get(b.sourceId) - perSource.get(a.sourceId) ||
        a.order - b.order,
    );
    const chosen = [];
    for (const v of usable) {
      const overlaps = chosen.some(
        (c) => c.style === v.style && c.weight.min <= v.weight.max && c.weight.max >= v.weight.min,
      );
      if (!overlaps) {
        chosen.push(v);
      } else if (v.sourceId === GOOGLE_ID) {
        warnings.push(
          `${family}: downloaded ${v.style} ${weightLabel(v.weight)} lost against a local face`,
        );
      }
    }
    if (chosen.length === 0) {
      warnings.push(`${family}: no usable face left, family skipped`);
      continue;
    }
    families.push(buildFamily(family, config, chosen));
  }
  return families;
}

function representativeWeights(config, variant, style) {
  const spec = variant.sourceId === GOOGLE_ID ? config.download : config;
  const listed = style === 'normal' ? spec?.weights : spec?.italicWeights;
  if (listed) return listed.filter((w) => w >= variant.weight.min && w <= variant.weight.max);
  const out = [];
  for (let w = Math.ceil(variant.weight.min / 100) * 100; w <= variant.weight.max; w += 100) {
    out.push(w);
  }
  return out;
}

function buildFamily(family, config, variants) {
  const id = config.id ?? kebab(family);
  const category = config.category;
  if (!manifest.fallbacks[category]) throw new Error(`${family}: unknown category '${category}'`);
  const weightsFor = (style) =>
    [
      ...new Set(
        variants
          .filter((v) => v.style === style)
          .flatMap((v) => representativeWeights(config, v, style)),
      ),
    ].sort((a, b) => a - b);
  const faces = variants.flatMap((v) =>
    [...v.subsets.values()].map((c) => ({
      style: c.style,
      weight: c.weight,
      subset: c.subset,
      unicodeRange: c.unicodeRange,
      file: c.file,
      dest: destName(id, c),
      sourceLabel: c.sourceLabel,
    })),
  );
  const sourceOrder = [manifest.google.label, ...manifest.sources.map((s) => s.label)];
  return {
    id,
    family,
    category,
    weights: weightsFor('normal'),
    italicWeights: weightsFor('italic'),
    variable: variants.some((v) => v.weight.min !== v.weight.max),
    fallback: `'${family}', ${config.fallback ?? manifest.fallbacks[category]}`,
    license: config.license ?? 'OFL-1.1',
    sources: sourceOrder.filter((label) => faces.some((f) => f.sourceLabel === label)),
    faces,
  };
}

function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function syncFiles(families) {
  if (!posix(fontsDir).endsWith('/public/fonts')) throw new Error(`refusing to manage ${fontsDir}`);
  const wanted = new Set();
  let copied = 0;
  for (const fam of families) {
    for (const face of fam.faces) {
      const dest = join(fontsDir, face.dest);
      if (wanted.has(dest)) throw new Error(`two faces map to ${face.dest}`);
      wanted.add(dest);
      if (face.file === dest) continue;
      if (existsSync(dest) && inspect(dest).sha === inspect(face.file).sha) continue;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(face.file, dest);
      inspected.delete(dest);
      copied++;
    }
  }
  const removed = [];
  const keep = new Set(['fonts.css', 'LICENSES.md']);
  const sweep = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        sweep(path);
        if (readdirSync(path).length === 0) rmdirSync(path);
      } else if (!wanted.has(path) && !(dir === fontsDir && keep.has(name))) {
        unlinkSync(path);
        removed.push(posix(relative(fontsDir, path)));
      }
    }
  };
  sweep(fontsDir);
  return { copied, removed };
}

function printTable(families) {
  const rows = sortFamilies(families).map((f) => [
    f.id,
    f.family,
    f.category,
    f.weights.join(' '),
    f.italicWeights.join(' ') || '-',
    f.variable ? 'yes' : 'no',
    f.sources.join(', '),
  ]);
  const head = ['id', 'family', 'category', 'weights', 'italics', 'variable', 'source'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

function report(result) {
  for (const w of result.warnings) console.log(`warn: ${w}`);
  for (const e of result.errors) console.log(`ERROR: ${e}`);
  if (result.stats) {
    const { families, faces, files, woff2Bytes, totalBytes } = result.stats;
    const mb = (b) => (b / 1024 / 1024).toFixed(2);
    console.log(
      `check: ${families} families, ${faces} @font-face rules, ${files} woff2 files, ` +
        `${mb(woff2Bytes)} MB woff2, ${mb(totalBytes)} MB total in public/fonts`,
    );
  }
  console.log(
    result.errors.length === 0 ? 'check: OK' : `check: FAILED (${result.errors.length} errors)`,
  );
  if (result.errors.length > 0) process.exitCode = 1;
}

async function build() {
  mkdirSync(fontsDir, { recursive: true });
  const lock = readLock();
  const local = collectLocal();
  const { candidates: remote, downloads } = await collectGoogle(lock);
  const families = selectFaces([...remote, ...local]);

  const { copied, removed } = syncFiles(families);
  writeIfChanged(join(fontsDir, 'fonts.css'), renderFontsCss(families));
  writeIfChanged(join(fontsDir, 'LICENSES.md'), renderLicenses(families));
  writeIfChanged(catalogPath, renderCatalog(families));
  writeIfChanged(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = checkOutputs({ fontsDir, catalogPath, manifest });
  writeIfChanged(previewPath, renderPreview(families, manifest, result.notes));

  for (const r of repairs) console.log(`repaired: ${r}`);
  for (const s of skipped) console.log(`skipped (not latin/latin-ext): ${s}`);
  for (const w of warnings) console.log(`warn: ${w}`);
  const excluded = Object.entries(manifest.families).filter(([, c]) => c.exclude);
  for (const [family, c] of excluded) console.log(`excluded: ${family} - ${c.exclude}`);
  console.log(
    `downloaded ${downloads.length} file(s), copied ${copied}, removed ${removed.length}`,
  );
  for (const r of removed) console.log(`  removed ${r}`);
  console.log('');
  printTable(families);
  console.log('');
  report(result);
}

if (args.has('--check')) {
  report(checkOutputs({ fontsDir, catalogPath, manifest }));
} else {
  await build();
}
