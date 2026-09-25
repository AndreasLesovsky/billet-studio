// Expands the seed colours in src/styles/themes/themes.json - the fixed site theme ("site") and the
// editor themes ("themes") - into the full --ui-* token set and writes four files (never edit them
// by hand):
//   src/styles/_themes.generated.scss                    one block per theme and per theme x mode
//   src/app/core/theme/theme-registry.generated.ts        ids, picker metadata, final colour tokens
//   src/app/core/theme/billet-theme-presets.generated.ts  the billet preset of every editor theme
//   public/theme-boot.js                                  sets the site theme + data-mode first
// Runs via the prestart/prebuild/pretest npm hooks. Every theme x mode must pass WCAG AA, every
// heading weight must be a face the font catalog ships, and every billet preset must use shipped
// faces and pass the billet contrast rules, otherwise the script exits 1 and writes nothing. Pure
// Node, no dependencies: the OKLCH math is below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'src', 'styles', 'themes', 'themes.json');
const FONT_CATALOG = join(root, 'src', 'app', 'billet', 'fonts', 'font-catalog.generated.ts');
const OUT_SCSS = join(root, 'src', 'styles', '_themes.generated.scss');
const OUT_TS = join(root, 'src', 'app', 'core', 'theme', 'theme-registry.generated.ts');
const OUT_PRESETS = join(root, 'src', 'app', 'core', 'theme', 'billet-theme-presets.generated.ts');
const OUT_BOOT = join(root, 'public', 'theme-boot.js');

const MODE_STORAGE_KEY = 'billet-studio.color-mode';
const MODES = ['light', 'dark'];

// The site's component layer sets running text at 400, medium UI text at 500 and labels/buttons at
// 600 (--ui-font-weight-strong); its body font must ship all three. Editor themes take the nearest
// face their body font has (font-synthesis-weight: none).
const SITE_BODY_WEIGHTS = [400, 500, 600];
const DEFAULT_HEADING_WEIGHT = 600;

// Families shipped by public/fonts/fonts.css (tools/asset-pipeline) and their fallback stacks.
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const CONDENSED = "'Arial Narrow', system-ui, sans-serif";
const FONTS = {
  Inter: SANS,
  Manrope: SANS,
  Outfit: SANS,
  'DM Sans': SANS,
  Nunito: SANS,
  Quicksand: SANS,
  'Space Grotesk': SANS,
  'Work Sans': SANS,
  Poppins: SANS,
  Lato: SANS,
  Raleway: SANS,
  Montserrat: SANS,
  Barlow: SANS,
  Jost: SANS,
  'Open Sans': SANS,
  Roboto: SANS,
  'Baloo 2': SANS,
  'Playfair Display': SERIF,
  'Cormorant Garamond': SERIF,
  'Libre Baskerville': SERIF,
  Merriweather: SERIF,
  'Abril Fatface': SERIF,
  Chewy: SANS,
  'Bebas Neue': CONDENSED,
  Oswald: CONDENSED,
};
// Display faces are fine for headings but not for running UI text.
const HEADING_ONLY_FONTS = new Set(['Abril Fatface', 'Chewy', 'Bebas Neue', 'Oswald']);

// WCAG thresholds; derivation targets sit slightly above them so rounding never lands on the edge.
const AA_TEXT = 4.5;
const AA_UI = 3;
const TARGET_TEXT = 4.6;
const TARGET_UI = 3.1;

// Base status colours in OKLCH; each theme nudges hue and chroma towards its own accent.
const STATUS = {
  danger: { h: 27, c: 0.19, light: 0.55, dark: 0.7 },
  success: { h: 150, c: 0.14, light: 0.52, dark: 0.74 },
  warning: { h: 72, c: 0.15, light: 0.72, dark: 0.8 },
  info: { h: 245, c: 0.13, light: 0.52, dark: 0.74 },
};

const WHITE = '#ffffff';
const BLACK = '#000000';

// ---------------------------------------------------------------------------------------------
// Colour math: sRGB <-> OKLab/OKLCH (Björn Ottosson) and WCAG 2.x relative luminance.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`invalid colour "${hex}" (expected #rrggbb)`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function toHex(rgb) {
  return `#${rgb
    .map((v) =>
      Math.round(clamp(v, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function hexToOklab(hex) {
  const [r, g, b] = parseHex(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function hexToOklch(hex) {
  const [l, a, b] = hexToOklab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l: L, c, h }) {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (linear) => linear.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** OKLCH -> hex; out-of-gamut colours keep lightness and hue and lose chroma. */
function oklchToHex({ l, c, h }) {
  const L = clamp(l, 0, 1);
  let linear = oklchToLinear({ l: L, c, h });
  if (!inGamut(linear)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l: L, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    linear = oklchToLinear({ l: L, c: lo, h });
  }
  return toHex(linear.map((v) => fromLinear(clamp(v, 0, 1))));
}

function oklabToHex([l, a, b]) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return oklchToHex({ l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h });
}

/** Perceptual mix in OKLab: t is the share of `to`. */
function mix(from, to, t) {
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  return oklabToHex(a.map((v, i) => v + (b[i] - v) * t));
}

function withLightness(hex, l) {
  return oklchToHex({ ...hexToOklch(hex), l });
}

const addLightness = (hex, delta) => withLightness(hex, hexToOklch(hex).l + delta);

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const minContrast = (hex, planes) => Math.min(...planes.map((p) => contrast(hex, p)));
const bestOn = (hex) => (contrast(hex, WHITE) >= contrast(hex, BLACK) ? WHITE : BLACK);

/** Moves the lightness of `hex` in `direction` (+1 lighter, -1 darker) until `ok` holds. */
function shiftUntil(hex, direction, ok, what) {
  if (ok(hex)) return hex;
  const base = hexToOklch(hex);
  for (let l = base.l; l >= 0 && l <= 1; l += direction * 0.004) {
    const candidate = oklchToHex({ ...base, l });
    if (ok(candidate)) return candidate;
  }
  throw new Error(`cannot derive ${what} from ${hex}`);
}

/** Mixes `from` towards `to`, starting at share `start` of `to` and backing off until `ok` holds. */
function mixUntil(from, to, start, ok, what) {
  for (let t = start; t >= 0; t -= 0.01) {
    const candidate = mix(from, to, t);
    if (ok(candidate)) return candidate;
  }
  throw new Error(`cannot derive ${what} from ${from}`);
}

const hueDistance = (from, to) => ((to - from + 540) % 360) - 180;

/** A quiet tint of `color` just off `bg`, built in OKLCH so a warm bg does not grey out a cool hue. */
function softTint(bg, color, dark) {
  const { l } = hexToOklch(bg);
  const { c, h } = hexToOklch(color);
  return oklchToHex({
    l: dark ? l + 0.075 : l - 0.035,
    c: Math.min(c * 0.35, dark ? 0.05 : 0.045),
    h,
  });
}

// ---------------------------------------------------------------------------------------------
// Derivation

/** Text direction for inks: darker on a light background, lighter on a dark one. */
const inkDirection = (bg) => (luminance(bg) > 0.18 ? -1 : 1);

/** The solid status colour closest to the preferred lightness that still carries a 4.5:1 label. */
function findSolid(name, { h, c, preferred }, planes) {
  let best = null;
  for (let l = 0.25; l <= 0.92; l += 0.005) {
    const hex = oklchToHex({ l, c, h });
    const readable = contrast(hex, bestOn(hex)) >= TARGET_TEXT;
    // Danger doubles as the invalid-field border and error icon colour: it needs UI contrast.
    const visible = name !== 'danger' || minContrast(hex, planes) >= TARGET_UI;
    const closer = !best || Math.abs(l - preferred) < Math.abs(best.l - preferred);
    if (readable && visible && closer) best = { l, hex };
  }
  if (!best) throw new Error(`cannot derive --ui-${name}`);
  return best.hex;
}

function deriveStatus(name, { bg, planes, dark, accent }) {
  const base = STATUS[name];
  const accentLch = hexToOklch(accent);
  const target = {
    h: (base.h + clamp(hueDistance(base.h, accentLch.h) * 0.1, -8, 8) + 360) % 360,
    c: base.c * clamp(accentLch.c / 0.14, 0.7, 1.25),
    preferred: dark ? base.dark : base.light,
  };
  const solid = findSolid(name, target, planes);
  const on = bestOn(solid);
  const soft = softTint(bg, solid, dark);
  const ink = shiftUntil(
    solid,
    inkDirection(bg),
    (x) => minContrast(x, [...planes, soft]) >= TARGET_TEXT,
    `--ui-${name}-ink`,
  );
  const tokens = { [name]: solid, [`${name}Soft`]: soft, [`${name}Ink`]: ink };
  tokens[`on${name[0].toUpperCase()}${name.slice(1)}`] = on;
  if (name === 'danger') tokens.dangerHover = addLightness(solid, on === WHITE ? -0.05 : 0.05);
  return tokens;
}

function deriveNeutrals({ bg, surface, text, sunken }, dark) {
  const surfaceRaised = dark ? addLightness(surface, 0.04) : mix(surface, WHITE, 0.6);
  // Mixing a near-neutral text into the bg keeps no tint; a theme that wants one seeds it.
  const surfaceSunken = sunken ?? (dark ? addLightness(bg, -0.025) : mix(bg, text, 0.04));
  const planes = [bg, surface, surfaceRaised, surfaceSunken];
  const quiet = [bg, surface, surfaceSunken];
  return {
    planes,
    tokens: {
      bg,
      surface,
      surfaceRaised,
      surfaceSunken,
      text,
      textMuted: mixUntil(
        text,
        bg,
        0.34,
        (x) => minContrast(x, planes) >= TARGET_TEXT,
        '--ui-text-muted',
      ),
      textSubtle: mixUntil(
        text,
        bg,
        0.52,
        (x) => minContrast(x, quiet) >= TARGET_UI,
        '--ui-text-subtle',
      ),
      border: mix(surface, text, dark ? 0.16 : 0.12),
      borderStrong: mixUntil(
        text,
        surface,
        0.72,
        (x) => minContrast(x, quiet) >= TARGET_UI,
        '--ui-border-strong',
      ),
    },
  };
}

function deriveAccent({ bg, accent, accent2 }, dark, planes) {
  const accentLch = hexToOklch(accent);
  const onAccent = bestOn(accent);
  const accentSoft = softTint(bg, accent, dark);
  const direction = inkDirection(bg);
  return {
    accent,
    // Hover moves away from the label colour, so the label only gains contrast.
    accentHover: addLightness(accent, onAccent === WHITE ? -0.055 : 0.055),
    accentSoft,
    onAccent,
    accentInk: shiftUntil(
      accent,
      direction,
      (x) => minContrast(x, [...planes, accentSoft]) >= TARGET_TEXT,
      '--ui-accent-ink',
    ),
    accent2: accent2 ?? oklchToHex({ ...accentLch, h: (accentLch.h + 40) % 360 }),
    focusRing: shiftUntil(
      accent,
      direction,
      (x) => minContrast(x, planes) >= TARGET_UI,
      '--ui-focus-ring',
    ),
  };
}

function deriveColors(theme, mode) {
  const seeds = theme[mode];
  const dark = mode === 'dark';
  const neutrals = deriveNeutrals(seeds, dark);
  const context = { bg: seeds.bg, planes: neutrals.planes, dark, accent: seeds.accent };
  return {
    ...neutrals.tokens,
    ...deriveAccent(seeds, dark, neutrals.planes),
    ...deriveStatus('danger', context),
    ...deriveStatus('success', context),
    ...deriveStatus('warning', context),
    ...deriveStatus('info', context),
  };
}

/** Every pair the UI relies on, with its WCAG minimum. theme-contrast.spec.ts re-checks the core. */
function contrastPairs(t) {
  const pairs = [];
  const add = (fg, bgs, min) => bgs.forEach((b) => pairs.push([fg, b, min]));
  const planes = ['bg', 'surface', 'surfaceRaised', 'surfaceSunken'];
  add('text', [...planes, 'accentSoft'], AA_TEXT);
  add('textMuted', planes, AA_TEXT);
  add('textSubtle', ['bg', 'surface', 'surfaceSunken'], AA_UI);
  add('borderStrong', ['bg', 'surface', 'surfaceSunken'], AA_UI);
  add('onAccent', ['accent', 'accentHover'], AA_TEXT);
  add('accentInk', [...planes, 'accentSoft'], AA_TEXT);
  add('accent', ['bg', 'surface'], AA_UI);
  add('focusRing', planes, AA_UI);
  add('danger', ['bg', 'surface', 'surfaceRaised'], AA_UI);
  add('onDanger', ['danger', 'dangerHover'], AA_TEXT);
  for (const s of ['danger', 'success', 'warning', 'info']) {
    const on = `on${s[0].toUpperCase()}${s.slice(1)}`;
    add(on, [s], AA_TEXT);
    add(`${s}Ink`, [...planes, `${s}Soft`], AA_TEXT);
    add('text', [`${s}Soft`], AA_TEXT);
  }
  return pairs.map(([fg, b, min]) => ({ fg, bg: b, min, ratio: contrast(t[fg], t[b]) }));
}

// ---------------------------------------------------------------------------------------------
// Validation of the source file

const HEX = /^#[0-9a-f]{6}$/;
const optional = (check) => (v) => v === undefined || check(v);
const within = (lo, hi) => (v) => typeof v === 'number' && v >= lo && v <= hi;
const isWeight = (v) => Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0;

const headingWeight = (theme) => theme.headingWeight ?? DEFAULT_HEADING_WEIGHT;
/** h1/h2, page titles and the wordmark; defaults to the heading weight. */
const displayWeight = (theme) => theme.displayWeight ?? headingWeight(theme);

/** Per-field rules for one theme: [field, predicate, message]. */
const THEME_RULES = [
  ['id', (v) => /^[a-z][a-z0-9]*$/.test(v ?? ''), 'id must match [a-z][a-z0-9]*'],
  [
    'fontBody',
    (v) => v in FONTS && !HEADING_ONLY_FONTS.has(v),
    'fontBody is not an available body font',
  ],
  ['fontHeading', (v) => v in FONTS, 'fontHeading is not an available font'],
  ['radius', within(0.4, 1.6), 'radius must be within 0.4..1.6'],
  ['headingWeight', optional(isWeight), 'headingWeight must be 100..900 in steps of 100'],
  ['displayWeight', optional(isWeight), 'displayWeight must be 100..900 in steps of 100'],
  ['headingScale', optional(within(0.8, 1.4)), 'headingScale must be within 0.8..1.4'],
  ['shadowTint', (v) => HEX.test(v ?? ''), 'shadowTint must be a lowercase #rrggbb'],
];
const SEED_KEYS = ['bg', 'surface', 'text', 'accent'];

function seedErrors(theme, mode) {
  const seeds = theme[mode];
  if (!seeds) return [`missing "${mode}" seeds`];
  const bad = SEED_KEYS.filter((key) => !HEX.test(seeds[key] ?? ''));
  for (const key of ['accent2', 'sunken']) {
    if (seeds[key] !== undefined && !HEX.test(seeds[key])) bad.push(key);
  }
  return bad.map((key) => `${mode}.${key} must be a lowercase #rrggbb`);
}

const CATALOG_ENTRY =
  /id: '([^']+)',\s*family: '([^']+)',[\s\S]*?\bweights: \[([^\]]*)\],\s*italicWeights: \[([^\]]*)\]/g;

/**
 * The faces the asset pipeline ships (read-only here; public/fonts is its output): upright weights
 * by family (the --ui-* fonts are named by family) and upright/italic weights by id (billet FontRef).
 */
function readFontCatalog() {
  const numbers = (list) =>
    list
      .split(',')
      .filter((v) => v.trim())
      .map(Number);
  const source = readFileSync(FONT_CATALOG, 'utf8');
  const entries = [...source.matchAll(CATALOG_ENTRY)].map((m) => ({
    id: m[1],
    family: m[2],
    weights: numbers(m[3]),
    italicWeights: numbers(m[4]),
  }));
  if (!entries.length) fail('Font catalog unreadable', [`no entry matched in ${FONT_CATALOG}`]);
  return {
    families: new Map(entries.map((e) => [e.family, e.weights])),
    faces: new Map(entries.map((e) => [e.id, e])),
  };
}

/** A requested weight the catalog does not ship would render in the nearest face instead. */
function weightErrors(theme, families, bodyWeights) {
  const wanted = [
    [theme.fontHeading, headingWeight(theme), 'headingWeight'],
    [theme.fontHeading, displayWeight(theme), 'displayWeight'],
    ...bodyWeights.map((w) => [theme.fontBody, w, 'body weight']),
  ];
  return wanted
    .filter(([family, weight]) => !(families.get(family) ?? []).includes(weight))
    .map(([family, weight, what]) => {
      const shipped = families.get(family)?.join('/') ?? 'none';
      return `${what} ${weight} is not shipped for ${family} (catalog: ${shipped})`;
    });
}

function themeErrors(theme, catalog, bodyWeights = []) {
  const fieldErrors = THEME_RULES.filter(([field, ok]) => !ok(theme[field])).map(
    ([, , message]) => message,
  );
  return [
    ...fieldErrors,
    ...MODES.flatMap((mode) => seedErrors(theme, mode)),
    ...(fieldErrors.length ? [] : weightErrors(theme, catalog.families, bodyWeights)),
  ];
}

function siteErrors(site, editorIds, catalog) {
  if (!site) return ['"site" (the fixed website theme) is missing'];
  const errors = themeErrors(site, catalog, SITE_BODY_WEIGHTS);
  if (editorIds.includes(site.id)) errors.push('its id must differ from every editor theme id');
  return errors.map((e) => `site "${site.id}": ${e}`);
}

// --- The billet preset of an editor theme: the shapes of docs/billet-document.md ---

const BILLET_PALETTE_KEYS = [
  'accent',
  'accentSoft',
  'border',
  'background',
  'ink',
  'inkSoft',
  'surface',
];
const BILLET_FONT_ROLES = ['title', 'titleAccent', 'heading', 'body', 'signature', 'ui'];
const BILLET_FONT_KEYS = ['fontId', 'weight', 'italic', 'size'];
const BILLET_EMPHASIS = ['inkSoft', 'accent'];
// FontRef.size is 0.5..2 in the document; a preset brings 4..7 of its 1..8 particle colours.
const BILLET_FONT_SIZE = within(0.5, 2);
const BILLET_PARTICLE_COLORS = { min: 4, max: 7 };

/** Missing and unknown keys: a misspelt seed must fail, not fall back silently. */
function keyErrors(value, keys, what) {
  if (value === undefined) return [`${what} is missing`];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${what} must be an object`];
  }
  return [
    ...keys.filter((key) => !(key in value)).map((key) => `${what}.${key} is missing`),
    ...Object.keys(value)
      .filter((key) => !keys.includes(key))
      .map((key) => `${what}.${key} is not a known key`),
  ];
}

function billetPaletteErrors(palette, what) {
  const errors = keyErrors(palette, BILLET_PALETTE_KEYS, what);
  if (errors.length) return errors;
  return BILLET_PALETTE_KEYS.filter((key) => !HEX.test(palette[key])).map(
    (key) => `${what}.${key} must be a lowercase #rrggbb`,
  );
}

/** A FontRef must name a catalog font and a face it ships, upright or italic as requested. */
function fontRefErrors(ref, faces, what) {
  const errors = keyErrors(ref, BILLET_FONT_KEYS, what);
  if (errors.length) return errors;
  const font = faces.get(ref.fontId);
  if (!font) return [`${what}.fontId "${ref.fontId}" is not in the font catalog`];
  if (typeof ref.italic !== 'boolean') errors.push(`${what}.italic must be a boolean`);
  if (!BILLET_FONT_SIZE(ref.size)) errors.push(`${what}.size must be within 0.5..2`);
  const shipped = ref.italic ? font.italicWeights : font.weights;
  if (!shipped.includes(ref.weight)) {
    const face = `${ref.weight}${ref.italic ? ' italic' : ''}`;
    const list = shipped.join('/') || 'none';
    errors.push(`${what}: ${ref.fontId} ${face} is not shipped (catalog: ${list})`);
  }
  return errors;
}

function billetTypographyErrors(typography, faces) {
  const what = 'billet.typography';
  const errors = keyErrors(typography, [...BILLET_FONT_ROLES, 'emphasis'], what);
  if (errors.length) return errors;
  if (!BILLET_EMPHASIS.includes(typography.emphasis)) {
    errors.push(`${what}.emphasis must be one of ${BILLET_EMPHASIS.join(', ')}`);
  }
  return [
    ...errors,
    ...BILLET_FONT_ROLES.flatMap((role) =>
      fontRefErrors(typography[role], faces, `${what}.${role}`),
    ),
  ];
}

function particleColorErrors(colors) {
  const { min, max } = BILLET_PARTICLE_COLORS;
  if (!Array.isArray(colors) || colors.length < min || colors.length > max) {
    return [`billet.particleColors must hold ${min}..${max} colours`];
  }
  return colors
    .filter((color) => !HEX.test(color))
    .map((color) => `billet.particleColors: "${color}" must be a lowercase #rrggbb`);
}

function billetErrors(billet, faces) {
  const errors = keyErrors(billet, [...MODES, 'typography', 'particleColors'], 'billet');
  if (errors.length) return errors;
  return [
    ...MODES.flatMap((mode) => billetPaletteErrors(billet[mode], `billet.${mode}`)),
    ...billetTypographyErrors(billet.typography, faces),
    ...particleColorErrors(billet.particleColors),
  ];
}

// Readability of a billet palette in light and dark: running text 4.5:1; the accent is display text
// (hero line 2, label, divider mark, signature) and needs 3:1 on the hero (accentSoft) and the page.
// The rose preset - the original card - passes every rule.
const BILLET_PAIRS = [
  ['ink', 'background', AA_TEXT],
  ['ink', 'surface', AA_TEXT],
  ['inkSoft', 'background', AA_TEXT],
  ['accent', 'accentSoft', AA_UI],
  ['accent', 'background', AA_UI],
];

function billetContrastFailures(themes) {
  const failures = [];
  for (const { id, billet } of themes) {
    for (const mode of MODES) {
      for (const [fg, bg, min] of BILLET_PAIRS) {
        const ratio = contrast(billet[mode][fg], billet[mode][bg]);
        if (ratio >= min) continue;
        failures.push(`${id}/${mode} billet: ${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
      }
    }
  }
  return failures;
}

function validate(source, catalog) {
  const themes = Array.isArray(source.themes) ? source.themes : [];
  const errors = themes.length ? [] : ['themes[] is empty'];
  const ids = themes.map((t) => t.id);
  for (const theme of themes) {
    const problems = [
      ...themeErrors(theme, catalog),
      ...billetErrors(theme.billet, catalog.faces),
      ...(ids.indexOf(theme.id) !== ids.lastIndexOf(theme.id) ? ['duplicate id'] : []),
    ];
    errors.push(...problems.map((p) => `theme "${theme.id}": ${p}`));
  }
  if (!ids.includes(source.default))
    errors.push(`default theme "${source.default}" is not defined`);
  errors.push(...siteErrors(source.site, ids, catalog));
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Output

const kebab = (key) => key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const rgbTriple = (hex) =>
  parseHex(hex)
    .map((v) => Math.round(v * 255))
    .join(' ');
const alpha = (hex, a) => `rgb(${rgbTriple(hex)} / ${a})`;
const fontStack = (family) => `'${family}', ${FONTS[family]}`;

function shadows(theme, mode) {
  if (mode === 'light') {
    const t = theme.shadowTint;
    return {
      sm: `0 0.0625rem 0.125rem ${alpha(t, 0.06)}, 0 0.0625rem 0.1875rem ${alpha(t, 0.1)}`,
      md: `0 0.125rem 0.25rem -0.0625rem ${alpha(t, 0.08)}, 0 0.5rem 1.25rem -0.25rem ${alpha(t, 0.14)}`,
      lg: `0 0.25rem 0.5rem -0.125rem ${alpha(t, 0.08)}, 0 1.5rem 3rem -0.75rem ${alpha(t, 0.24)}`,
    };
  }
  const t = mix(theme.shadowTint, BLACK, 0.75);
  return {
    sm: `0 0.0625rem 0.125rem ${alpha(t, 0.3)}, 0 0.0625rem 0.1875rem ${alpha(t, 0.35)}`,
    md: `0 0.125rem 0.25rem -0.0625rem ${alpha(t, 0.4)}, 0 0.5rem 1.25rem -0.25rem ${alpha(t, 0.5)}`,
    lg: `0 0.25rem 0.5rem -0.125rem ${alpha(t, 0.45)}, 0 1.5rem 3rem -0.75rem ${alpha(t, 0.65)}`,
  };
}

function overlay(theme, mode, colors) {
  return mode === 'light'
    ? alpha(mix(colors.text, theme.shadowTint, 0.5), 0.42)
    : alpha(mix(colors.bg, BLACK, 0.6), 0.66);
}

/** One SCSS declaration, wrapped the way Prettier (printWidth 100) would, so the output is stable. */
function declaration(property, value) {
  // Prettier counts the semicolon on a one-line declaration, but not on a wrapped value line.
  if (`    ${property}: ${value};`.length <= 100) return `    ${property}: ${value};`;
  if (`        ${value}`.length <= 100) return `    ${property}:\n        ${value};`;
  const layers = value.split(/,\s(?![^(]*\))/);
  return `    ${property}:\n${layers.map((l) => `        ${l}`).join(',\n')};`;
}

const HEADER =
  'AUTO-GENERATED by scripts/generate-themes.mjs from src/styles/themes/themes.json. Do not edit.';

/** Mode-independent tokens: fonts and radii. */
function themeBlock(theme, rootFallback) {
  return [
    `${rootFallback ? `${rootFallback},\n` : ''}[data-theme='${theme.id}'] {`,
    declaration('--ui-font-body', fontStack(theme.fontBody)),
    declaration('--ui-font-heading', fontStack(theme.fontHeading)),
    declaration('--ui-font-heading-weight', headingWeight(theme)),
    declaration('--ui-font-display-weight', displayWeight(theme)),
    // Evens out display faces with a small x-height (Cormorant) or a condensed cap-only cut (Bebas).
    declaration('--ui-font-heading-scale', theme.headingScale ?? 1),
    ...['sm', 'md', 'lg', 'xl'].map(
      (step) => `    --ui-radius-${step}: #{tokens.radius(${step}, ${theme.radius})};`,
    ),
    '}',
    '',
  ];
}

function modeBlock(theme, mode, colors, rootFallback) {
  return [
    `${rootFallback ? `${rootFallback},\n` : ''}[data-theme='${theme.id}'][data-mode='${mode}'] {`,
    `    color-scheme: ${mode};`,
    ...Object.entries(colors).map(([key, value]) => declaration(`--ui-${kebab(key)}`, value)),
    declaration('--ui-overlay', overlay(theme, mode, colors)),
    ...Object.entries(shadows(theme, mode)).map(([size, value]) =>
      declaration(`--ui-shadow-${size}`, value),
    ),
    '}',
    '',
  ];
}

// A <html> without data-theme (theme-boot.js did not run) still renders as the site; the dark
// fallback outranks the light one by specificity.
const SITE_ROOT_FALLBACK = {
  fonts: ':root:not([data-theme])',
  light: ':root:not([data-theme])',
  dark: ":root:not([data-theme])[data-mode='dark']",
};

function renderScss(site, themes, derived) {
  const out = [
    `// ${HEADER}`,
    `// The site theme ("${site.id}") is the one <html> carries (public/theme-boot.js). Editor themes`,
    '// apply only to an element that carries data-theme + data-mode itself (ThemeScope: the editor',
    '// root, theme-picker cards, the dev ui-kit), which is why no selector here is :root-only.',
    "@use 'tokens';",
    '',
    ...themeBlock(site, SITE_ROOT_FALLBACK.fonts),
    ...MODES.flatMap((mode) =>
      modeBlock(site, mode, derived[site.id][mode], SITE_ROOT_FALLBACK[mode]),
    ),
  ];
  for (const theme of themes) {
    out.push(...themeBlock(theme, null));
    for (const mode of MODES) out.push(...modeBlock(theme, mode, derived[theme.id][mode], null));
  }
  return out.join('\n').trimEnd() + '\n';
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function colorTokenLines(colors, colorKeys, indent) {
  return colorKeys.map((k) => `${indent}${k}: ${quote(colors[k])},`);
}

function renderRegistry(site, themes, defaultId, derived) {
  const colorKeys = Object.keys(derived[themes[0].id].light);
  const swatch = (mode, c) => [
    `      ${mode}: {`,
    ...['bg', 'surface', 'text', 'accent', 'accent2'].map((k) => `        ${k}: ${quote(c[k])},`),
    '      },',
  ];
  const lines = [
    `// ${HEADER}`,
    '',
    '/** The editor themes, in picker order. The site theme is not one of them. */',
    'export const THEME_IDS = [',
    ...themes.map((t) => `  ${quote(t.id)},`),
    '] as const;',
    '',
    'export type ThemeId = (typeof THEME_IDS)[number];',
    '',
    "export type ColorMode = 'light' | 'dark';",
    '',
    `export const DEFAULT_THEME: ThemeId = ${quote(defaultId)};`,
    '',
    '/** The fixed website theme on <html>; never offered as an editor theme. */',
    `export const SITE_THEME = ${quote(site.id)};`,
    '',
    '// Shared with public/theme-boot.js, which reads it before the app bootstraps.',
    `export const COLOR_MODE_STORAGE_KEY = ${quote(MODE_STORAGE_KEY)};`,
    '',
    'export interface ThemeSwatch {',
    '  readonly bg: string;',
    '  readonly surface: string;',
    '  readonly text: string;',
    '  readonly accent: string;',
    '  readonly accent2: string;',
    '}',
    '',
    'export interface ThemeMeta {',
    '  readonly id: ThemeId;',
    '  readonly nameKey: string;',
    '  readonly fontBody: string;',
    '  readonly fontHeading: string;',
    '  readonly swatch: Readonly<Record<ColorMode, ThemeSwatch>>;',
    '}',
    '',
    'export const THEMES: readonly ThemeMeta[] = [',
  ];
  for (const t of themes) {
    lines.push(
      '  {',
      `    id: ${quote(t.id)},`,
      `    nameKey: ${quote(`THEMES.${t.id.toUpperCase()}`)},`,
      `    fontBody: ${quote(t.fontBody)},`,
      `    fontHeading: ${quote(t.fontHeading)},`,
      '    swatch: {',
      ...swatch('light', derived[t.id].light),
      ...swatch('dark', derived[t.id].dark),
      '    },',
      '  },',
    );
  }
  lines.push(
    '];',
    '',
    'export function isThemeId(value: unknown): value is ThemeId {',
    "  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);",
    '}',
    '',
    '/** Final colour values, keyed by the camelCase of the --ui-* token name. */',
    'export interface ThemeColorTokens {',
    ...colorKeys.map((k) => `  readonly ${k}: string;`),
    '}',
    '',
    'type ModeTokens = Readonly<Record<ColorMode, ThemeColorTokens>>;',
    '',
    '/** Read by theme-contrast.spec.ts only; tree-shaken from the app bundle. */',
    'export const THEME_COLOR_TOKENS: Readonly<Record<ThemeId, ModeTokens>> = {',
  );
  for (const t of themes) {
    lines.push(`  ${t.id}: {`);
    for (const mode of MODES) {
      lines.push(
        `    ${mode}: {`,
        ...colorTokenLines(derived[t.id][mode], colorKeys, '      '),
        '    },',
      );
    }
    lines.push('  },');
  }
  lines.push(
    '};',
    '',
    "/** The site theme's final colour values; read by theme-contrast.spec.ts only. */",
    'export const SITE_COLOR_TOKENS: ModeTokens = {',
    ...MODES.flatMap((mode) => [
      `  ${mode}: {`,
      ...colorTokenLines(derived[site.id][mode], colorKeys, '    '),
      '  },',
    ]),
    '};',
    '',
  );
  return lines.join('\n');
}

/** `key: { a, b },` / `key: [a, b],` on one line when it fits Prettier's 100 columns, else wrapped. */
function literal(indent, key, entries, [open, close]) {
  const pad = open === '{' ? ' ' : '';
  const line = `${indent}${key}: ${open}${pad}${entries.join(', ')}${pad}${close},`;
  if (line.length <= 100) return [line];
  return [
    `${indent}${key}: ${open}`,
    ...entries.map((e) => `${indent}  ${e},`),
    `${indent}${close},`,
  ];
}

function presetLines({ id, billet }) {
  const palette = (mode) => [
    `      ${mode}: {`,
    ...BILLET_PALETTE_KEYS.map((key) => `        ${key}: ${quote(billet[mode][key])},`),
    '      },',
  ];
  const font = (role) => {
    const { fontId, weight, italic, size } = billet.typography[role];
    const entries = [`fontId: ${quote(fontId)}`, `weight: ${weight}`, `italic: ${italic}`];
    return literal('      ', role, [...entries, `size: ${size}`], ['{', '}']);
  };
  return [
    `  ${id}: {`,
    '    palette: {',
    ...MODES.flatMap(palette),
    '    },',
    '    typography: {',
    ...BILLET_FONT_ROLES.flatMap(font),
    `      emphasis: ${quote(billet.typography.emphasis)},`,
    '    },',
    ...literal('    ', 'particleColors', billet.particleColors.map(quote), ['[', ']']),
    '  },',
  ];
}

function renderBilletPresets(themes) {
  return [
    `// ${HEADER}`,
    '',
    "import { DEFAULT_THEME, isThemeId, ThemeId } from './theme-registry.generated';",
    '',
    '// The shapes of BilletPalette, FontRef and typography in docs/billet-document.md.',
    'interface BilletPresetPalette {',
    ...BILLET_PALETTE_KEYS.map((key) => `  readonly ${key}: string;`),
    '}',
    '',
    'interface BilletPresetFont {',
    '  readonly fontId: string;',
    '  readonly weight: number;',
    '  readonly italic: boolean;',
    '  readonly size: number;',
    '}',
    '',
    'interface BilletPresetTypography {',
    ...BILLET_FONT_ROLES.map((role) => `  readonly ${role}: BilletPresetFont;`),
    `  readonly emphasis: ${BILLET_EMPHASIS.map(quote).join(' | ')};`,
    '}',
    '',
    '/**',
    ' * What picking an editor theme writes into a billet: palette.light / palette.dark, typography and',
    ' * particles.colors. The objects are shared: copy them into a document, never alias them.',
    ' */',
    'export interface BilletThemePreset {',
    '  readonly palette: {',
    '    readonly light: BilletPresetPalette;',
    '    readonly dark: BilletPresetPalette;',
    '  };',
    '  readonly typography: BilletPresetTypography;',
    '  readonly particleColors: readonly string[];',
    '}',
    '',
    'export const BILLET_THEME_PRESETS: Readonly<Record<ThemeId, BilletThemePreset>> = {',
    ...themes.flatMap(presetLines),
    '};',
    '',
    "/** The billet preset of an editor theme; an unknown id gets the default theme's preset. */",
    'export function billetPresetFor(id: string): BilletThemePreset {',
    '  return BILLET_THEME_PRESETS[isThemeId(id) ? id : DEFAULT_THEME];',
    '}',
    '',
  ].join('\n');
}

function renderBoot(site) {
  return `// ${HEADER}
// Runs before the app bootstraps, so the first paint already carries the site theme and the colour
// mode. The site always renders in its own theme; editor themes are element-scoped and never set
// here. Plain ES5 on purpose: it must never throw, even with storage blocked or matchMedia missing.
(function () {
  var mode = null;
  try {
    mode = localStorage.getItem('${MODE_STORAGE_KEY}');
  } catch (e) {
    // Storage blocked (private mode, sandboxed frame): follow the system below.
  }
  if (mode !== 'light' && mode !== 'dark') {
    try {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      mode = 'light';
    }
  }
  document.documentElement.setAttribute('data-theme', '${site.id}');
  document.documentElement.setAttribute('data-mode', mode);
})();
`;
}

function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  writeFileSync(file, content);
  return true;
}

// ---------------------------------------------------------------------------------------------

function fail(title, lines) {
  console.error(`${title}:\n  ${lines.join('\n  ')}`);
  process.exit(1);
}

/** Derives every theme x mode; returns the token sets and every derivation or AA failure. */
function deriveAll(themes) {
  const derived = {};
  const failures = [];
  for (const theme of themes) {
    derived[theme.id] = {};
    for (const mode of MODES) {
      const at = `${theme.id}/${mode}`;
      try {
        derived[theme.id][mode] = deriveColors(theme, mode);
      } catch (error) {
        failures.push(`${at}: ${error.message}`);
        continue;
      }
      failures.push(
        ...contrastPairs(derived[theme.id][mode])
          .filter((p) => p.ratio < p.min)
          .map((p) => `${at}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (< ${p.min})`),
      );
    }
  }
  return { derived, failures };
}

function printTables(site, themes, derived) {
  console.table(
    [site, ...themes].map((t) => ({
      id: t === site ? `${t.id} (site)` : t.id,
      body: t.fontBody,
      heading: `${t.fontHeading} ${headingWeight(t)}/${displayWeight(t)}`,
      light: derived[t.id].light.accent,
      dark: derived[t.id].dark.accent,
    })),
  );
  const face = ({ fontId, weight, italic }) => `${fontId} ${weight}${italic ? ' italic' : ''}`;
  console.table(
    themes.map(({ id, billet }) => ({
      billet: id,
      accent: `${billet.light.accent} / ${billet.dark.accent}`,
      title: face(billet.typography.title),
      titleAccent: face(billet.typography.titleAccent),
      body: face(billet.typography.body),
    })),
  );
}

function main() {
  const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const errors = validate(source, readFontCatalog());
  if (errors.length) fail('themes.json is invalid', errors);

  const { site, themes } = source;
  const { derived, failures } = deriveAll([site, ...themes]);
  failures.push(...billetContrastFailures(themes));
  if (failures.length) {
    fail('Contrast check failed (WCAG AA for the UI, readability rules for billets)', failures);
  }

  const outputs = [
    [OUT_SCSS, renderScss(site, themes, derived)],
    [OUT_TS, renderRegistry(site, themes, source.default, derived)],
    [OUT_PRESETS, renderBilletPresets(themes)],
    [OUT_BOOT, renderBoot(site)],
  ];
  const changed = outputs.filter(([file, content]) => writeIfChanged(file, content));

  if (process.argv.includes('--table')) printTables(site, themes, derived);
  const summary = changed.length
    ? `wrote ${changed.map(([file]) => basename(file)).join(', ')}`
    : 'outputs unchanged';
  console.log(
    `themes -> site "${site.id}" + ${themes.length} editor themes x ${MODES.length} modes pass WCAG AA, ${themes.length} billet presets pass; ${summary}`,
  );
}

main();
