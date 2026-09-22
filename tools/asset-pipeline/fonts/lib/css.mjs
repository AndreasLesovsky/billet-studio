/** Parses every @font-face rule of a stylesheet into plain descriptor objects. */
export function parseFontFaces(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const faces = [];
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const descriptors = {};
    for (const decl of match[1].split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      descriptors[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim();
    }
    const src = descriptors['src'] ?? '';
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(src)?.[1] ?? null;
    faces.push({
      family: unquote(descriptors['font-family'] ?? ''),
      style: descriptors['font-style'] === 'italic' ? 'italic' : 'normal',
      weight: parseWeight(descriptors['font-weight'] ?? '400'),
      unicodeRange: normalizeRange(descriptors['unicode-range'] ?? null),
      display: descriptors['font-display'] ?? null,
      format: /format\(\s*['"]?([\w-]+)/.exec(src)?.[1] ?? null,
      url,
    });
  }
  return faces;
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function parseWeight(value) {
  const named = { normal: 400, bold: 700 };
  const parts = value
    .trim()
    .split(/\s+/)
    .map((p) => named[p] ?? Number(p));
  if (parts.some((p) => !Number.isFinite(p))) throw new Error(`unsupported font-weight '${value}'`);
  return { min: parts[0], max: parts[1] ?? parts[0] };
}

export function normalizeRange(range) {
  if (!range) return null;
  return range
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean)
    .join(', ');
}

/** Converts a unicode-range string into [start, end] intervals. */
export function rangeIntervals(range) {
  if (!range) return [[0, 0x10ffff]];
  return range.split(',').map((part) => {
    const body = part.trim().replace(/^U\+/i, '');
    if (body.includes('?')) {
      return [parseInt(body.replace(/\?/g, '0'), 16), parseInt(body.replace(/\?/g, 'F'), 16)];
    }
    const [a, b] = body.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

export function inRange(intervals, codepoint) {
  return intervals.some(([a, b]) => codepoint >= a && codepoint <= b);
}

/** Maps a declared unicode-range onto the Google subset it belongs to. */
export function subsetOfRange(range) {
  const intervals = rangeIntervals(range);
  if (inRange(intervals, 0x41)) return 'latin';
  if (inRange(intervals, 0x100)) return 'latin-ext';
  return 'other';
}

function share(codepoints, from, to) {
  let hit = 0;
  for (let c = from; c <= to; c++) if (codepoints.has(c)) hit++;
  return hit / (to - from + 1);
}

/** Infers the subset of a file that declares no unicode-range, from its cmap. */
export function subsetOfCodepoints(codepoints) {
  const latin = share(codepoints, 0x41, 0x5a) === 1 && share(codepoints, 0xc0, 0xff) >= 0.9;
  const latinExt = share(codepoints, 0x100, 0x17f) >= 0.9;
  if (latin && latinExt) return 'all';
  if (latin) return 'latin';
  if (latinExt) return 'latin-ext';
  return 'other';
}

export function weightLabel(weight) {
  return weight.min === weight.max ? String(weight.min) : `${weight.min} ${weight.max}`;
}
