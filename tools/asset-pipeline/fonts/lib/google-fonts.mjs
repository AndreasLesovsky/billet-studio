import { normalizeRange } from './css.mjs';

/** css2 family parameter, e.g. `Jost:ital,wght@0,300;0,400;1,300`. */
export function familyQuery(family, spec) {
  const name = family.replace(/ /g, '+');
  const italics = spec.italicWeights ?? [];
  if (italics.length === 0) return `${name}:wght@${spec.weights.join(';')}`;
  const tuples = [...spec.weights.map((w) => `0,${w}`), ...italics.map((w) => `1,${w}`)];
  return `${name}:ital,wght@${tuples.join(';')}`;
}

async function fetchOk(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response;
}

/**
 * Fetches the css2 stylesheet and returns one face per (style, subset, file). Weights that
 * Google serves from the same file are a variable font and collapse into one weight range.
 */
export async function fetchGoogleFaces(query, google, subsets) {
  // Without a modern browser User-Agent the API answers with TTF and no unicode-range blocks.
  const url = `${google.cssUrl}?family=${query}&display=swap`;
  const css = await (await fetchOk(url, { headers: { 'User-Agent': google.userAgent } })).text();
  const byFile = new Map();
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const subset = m[1];
    if (!subsets.includes(subset)) continue;
    const body = m[2];
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const weights = /font-weight:\s*([\d ]+);/.exec(body)[1].trim().split(/\s+/).map(Number);
    const fileUrl = /url\(([^)]+)\)/.exec(body)[1];
    const unicodeRange = normalizeRange(/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? null);
    const key = `${style}|${subset}|${fileUrl}`;
    const entry = byFile.get(key) ?? { style, subset, url: fileUrl, unicodeRange, weights: [] };
    entry.weights.push(...weights);
    byFile.set(key, entry);
  }
  return [...byFile.values()].map(({ weights, ...face }) => ({
    ...face,
    weight: { min: Math.min(...weights), max: Math.max(...weights) },
  }));
}

export async function downloadBinary(url) {
  return Buffer.from(await (await fetchOk(url)).arrayBuffer());
}
