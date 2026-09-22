import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { inRange, parseFontFaces, rangeIntervals, weightLabel } from './css.mjs';
import { inspectWoff2 } from './woff2.mjs';

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

/** Reads FONT_CATALOG back from the generated TypeScript (the format renderCatalog writes). */
export function parseCatalog(ts) {
  const nums = (s) => (s.trim() ? s.split(',').map((n) => Number(n.trim())) : []);
  const entry =
    /\{\s*id: '([^']+)',\s*family: '([^']+)',\s*category: '(\w+)',\s*weights: \[([^\]]*)\],\s*italicWeights: \[([^\]]*)\],\s*variable: (true|false),\s*fallback: "([^"]+)",\s*\}/g;
  return [...ts.matchAll(entry)].map((m) => ({
    id: m[1],
    family: m[2],
    category: m[3],
    weights: nums(m[4]),
    italicWeights: nums(m[5]),
    variable: m[6] === 'true',
    fallback: m[7],
  }));
}

/**
 * Verifies fonts.css, the woff2 files and the catalog against each other. Returns errors,
 * warnings, per-family coverage notes and size statistics.
 */
export function checkOutputs({ fontsDir, catalogPath, manifest }) {
  const errors = [];
  const warnings = [];
  const notes = new Map();
  const cssPath = join(fontsDir, 'fonts.css');
  const missing = [cssPath, catalogPath].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return { errors: missing.map((p) => `missing ${p}`), warnings, notes, stats: null };
  }

  const faces = parseFontFaces(readFileSync(cssPath, 'utf8'));
  const referenced = new Set();
  const seen = new Set();
  const info = new Map();
  for (const face of faces) {
    const label = `${face.family} ${face.style} ${weightLabel(face.weight)}`;
    if (!face.url) {
      errors.push(`${label}: no url()`);
      continue;
    }
    const file = resolve(fontsDir, face.url);
    if (!existsSync(file)) {
      errors.push(`${label}: url('${face.url}') does not resolve to a file`);
      continue;
    }
    referenced.add(file);
    if (face.display !== 'swap') errors.push(`${label}: font-display is not swap`);
    if (face.format !== 'woff2') errors.push(`${label}: format is not woff2`);
    const key = `${face.family}|${face.style}|${weightLabel(face.weight)}|${face.unicodeRange ?? '*'}`;
    if (seen.has(key)) {
      errors.push(`duplicate face ${label} (${face.unicodeRange ?? 'no unicode-range'})`);
    }
    seen.add(key);
    if (!info.has(file)) info.set(file, inspectWoff2(readFileSync(file)));
    const meta = info.get(file);
    const variable = face.weight.min !== face.weight.max;
    const wght = meta.axes['wght'];
    if (variable && (!wght || wght.min > face.weight.min || wght.max < face.weight.max)) {
      warnings.push(
        `${label}: declared range exceeds the file's wght axis (${wght ? `${wght.min}-${wght.max}` : 'none'})`,
      );
    }
    // Static instances of 100/200 carry weight class 250 for legacy Windows GDI.
    const legacyThin = face.weight.min <= 200 && meta.weightClass === 250;
    if (!variable && !wght && meta.weightClass !== face.weight.min && !legacyThin) {
      warnings.push(`${label}: file weight class is ${meta.weightClass}`);
    }
    if (meta.italic !== null && meta.italic !== (face.style === 'italic')) {
      warnings.push(`${label}: file italic flag is ${meta.italic}`);
    }
  }

  const files = listFiles(fontsDir);
  for (const file of files) {
    if (file.endsWith('.woff2') && !referenced.has(file)) {
      const rel = relative(fontsDir, file).split(sep).join('/');
      errors.push(`orphan file ${rel} (not referenced by fonts.css)`);
    }
  }

  const catalog = parseCatalog(readFileSync(catalogPath, 'utf8'));
  if (catalog.length === 0) errors.push('catalog has no entries (format not recognised)');
  const cssFamilies = new Set(faces.map((f) => f.family));
  const ids = new Set();
  for (const entry of catalog) {
    if (ids.has(entry.id)) errors.push(`catalog: duplicate id ${entry.id}`);
    ids.add(entry.id);
    cssFamilies.delete(entry.family);
    const own = faces.filter((f) => f.family === entry.family && f.url);
    if (own.length === 0) {
      errors.push(`catalog: ${entry.id} has no @font-face`);
      continue;
    }
    if (!entry.fallback.startsWith(`'${entry.family}',`)) {
      errors.push(`catalog: ${entry.id} fallback does not start with '${entry.family}'`);
    }
    const missingByChar = new Map();
    const slots = [
      ...entry.weights.map((w) => ['normal', w]),
      ...entry.italicWeights.map((w) => ['italic', w]),
    ];
    if (entry.weights.length === 0) errors.push(`catalog: ${entry.id} has no upright weight`);
    for (const [style, w] of slots) {
      const matching = own.filter(
        (f) => f.style === style && f.weight.min <= w && f.weight.max >= w,
      );
      if (matching.length === 0) {
        errors.push(`catalog: ${entry.id} ${style} ${w} has no matching @font-face`);
        continue;
      }
      const covered = (cp) =>
        matching.some((f) => {
          const meta = info.get(resolve(fontsDir, f.url));
          return meta?.codepoints.has(cp) && inRange(rangeIntervals(f.unicodeRange), cp);
        });
      for (const ch of new Set(manifest.sampleText.replace(/\s/g, ''))) {
        if (!covered(ch.codePointAt(0))) {
          const list = missingByChar.get(ch) ?? [];
          list.push(`${w}${style === 'italic' ? 'i' : ''}`);
          missingByChar.set(ch, list);
        }
      }
    }
    if (missingByChar.size > 0) {
      const parts = [...missingByChar].map(
        ([ch, where]) => `'${ch}'${where.length === slots.length ? '' : ` (${where.join(', ')})`}`,
      );
      const message = `missing sample glyphs: ${parts.join(', ')}`;
      notes.set(entry.id, message);
      const hard = [...missingByChar.keys()].filter((ch) => manifest.requiredChars.includes(ch));
      (hard.length > 0 ? errors : warnings).push(`${entry.id}: ${message}`);
    }
  }
  for (const family of cssFamilies) {
    errors.push(`fonts.css family '${family}' is not in the catalog`);
  }

  const woff2 = files.filter((f) => f.endsWith('.woff2'));
  const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const woff2Bytes = woff2.reduce((sum, f) => sum + statSync(f).size, 0);
  return {
    errors,
    warnings,
    notes,
    stats: {
      families: catalog.length,
      faces: faces.length,
      files: woff2.length,
      woff2Bytes,
      totalBytes,
    },
  };
}
