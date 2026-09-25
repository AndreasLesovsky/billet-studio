// Expands the seed colours in src/styles/themes/themes.json into the full --ui-* token set and
// writes three files (never edit them by hand):
//   src/styles/_themes.generated.scss              one block per theme and per theme x mode
//   src/app/core/theme/theme-registry.generated.ts  ids, picker metadata, final colour tokens
//   public/theme-boot.js                            sets data-theme / data-mode before first paint
// Runs via the prestart/prebuild/pretest npm hooks. Every theme x mode must pass WCAG AA, otherwise
// the script exits 1 and writes nothing. Pure Node, no dependencies: the OKLCH math is below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'src', 'styles', 'themes', 'themes.json');
const OUT_SCSS = join(root, 'src', 'styles', '_themes.generated.scss');
const OUT_TS = join(root, 'src', 'app', 'core', 'theme', 'theme-registry.generated.ts');
const OUT_BOOT = join(root, 'public', 'theme-boot.js');

const THEME_STORAGE_KEY = 'billet-studio.theme';
const MODE_STORAGE_KEY = 'billet-studio.color-mode';
const MODES = ['light', 'dark'];

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

function deriveNeutrals({ bg, surface, text }, dark) {
  const surfaceRaised = dark ? addLightness(surface, 0.04) : mix(surface, WHITE, 0.6);
  const surfaceSunken = dark ? addLightness(bg, -0.025) : mix(bg, text, 0.04);
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
  [
    'headingWeight',
    optional((v) => [400, 500, 600, 700].includes(v)),
    'headingWeight must be 400..700 in steps of 100',
  ],
  ['headingScale', optional(within(0.8, 1.4)), 'headingScale must be within 0.8..1.4'],
  ['shadowTint', (v) => HEX.test(v ?? ''), 'shadowTint must be a lowercase #rrggbb'],
];
const SEED_KEYS = ['bg', 'surface', 'text', 'accent'];

function seedErrors(theme, mode) {
  const seeds = theme[mode];
  if (!seeds) return [`missing "${mode}" seeds`];
  const bad = SEED_KEYS.filter((key) => !HEX.test(seeds[key] ?? ''));
  if (seeds.accent2 !== undefined && !HEX.test(seeds.accent2)) bad.push('accent2');
  return bad.map((key) => `${mode}.${key} must be a lowercase #rrggbb`);
}

function validate(source) {
  const themes = Array.isArray(source.themes) ? source.themes : [];
  const errors = themes.length ? [] : ['themes[] is empty'];
  const ids = themes.map((t) => t.id);
  for (const theme of themes) {
    const problems = [
      ...THEME_RULES.filter(([field, ok]) => !ok(theme[field])).map(([, , message]) => message),
      ...MODES.flatMap((mode) => seedErrors(theme, mode)),
      ...(ids.indexOf(theme.id) !== ids.lastIndexOf(theme.id) ? ['duplicate id'] : []),
    ];
    errors.push(...problems.map((p) => `theme "${theme.id}": ${p}`));
  }
  if (!ids.includes(source.default))
    errors.push(`default theme "${source.default}" is not defined`);
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

/** Mode-independent tokens: fonts and radii. The default theme also covers a bare <html>. */
function themeBlock(theme, isDefault) {
  return [
    `${isDefault ? ':root:not([data-theme]),\n' : ''}[data-theme='${theme.id}'] {`,
    declaration('--ui-font-body', fontStack(theme.fontBody)),
    declaration('--ui-font-heading', fontStack(theme.fontHeading)),
    declaration('--ui-font-heading-weight', theme.headingWeight ?? 600),
    // Evens out display faces with a small x-height (Cormorant) or a condensed cap-only cut (Bebas).
    declaration('--ui-font-heading-scale', theme.headingScale ?? 1),
    ...['sm', 'md', 'lg', 'xl'].map(
      (step) => `    --ui-radius-${step}: #{tokens.radius(${step}, ${theme.radius})};`,
    ),
    '}',
    '',
  ];
}

function modeBlock(theme, mode, colors, isDefault) {
  const fallback = isDefault && mode === 'light' ? ':root:not([data-theme][data-mode]),\n' : '';
  return [
    `${fallback}[data-theme='${theme.id}'][data-mode='${mode}'] {`,
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

function renderScss(themes, defaultId, derived) {
  const out = [
    `// ${HEADER}`,
    '// Selectors are attribute-based (not :root-only), so any element can preview a theme by',
    '// carrying data-theme + data-mode itself (theme-picker cards).',
    "@use 'tokens';",
    '',
  ];
  for (const theme of themes) {
    const isDefault = theme.id === defaultId;
    out.push(...themeBlock(theme, isDefault));
    for (const mode of MODES)
      out.push(...modeBlock(theme, mode, derived[theme.id][mode], isDefault));
  }
  return out.join('\n').trimEnd() + '\n';
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function renderRegistry(themes, defaultId, derived) {
  const colorKeys = Object.keys(derived[themes[0].id].light);
  const swatch = (mode, c) => [
    `      ${mode}: {`,
    ...['bg', 'surface', 'text', 'accent', 'accent2'].map((k) => `        ${k}: ${quote(c[k])},`),
    '      },',
  ];
  const lines = [
    `// ${HEADER}`,
    '',
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
    '// Shared with public/theme-boot.js, which reads them before the app bootstraps.',
    `export const THEME_STORAGE_KEY = ${quote(THEME_STORAGE_KEY)};`,
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
      const c = derived[t.id][mode];
      lines.push(
        `    ${mode}: {`,
        ...colorKeys.map((k) => `      ${k}: ${quote(c[k])},`),
        '    },',
      );
    }
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}

function renderBoot(themes, defaultId) {
  return `// ${HEADER}
// Runs before the app bootstraps, so the first paint already carries the theme attributes.
// Plain ES5 on purpose: it must never throw, even with storage blocked or matchMedia missing.
(function () {
  var ids = [
${themes.map((t) => `    '${t.id}',`).join('\n')}
  ];
  var root = document.documentElement;
  var theme = null;
  var mode = null;
  try {
    theme = localStorage.getItem('${THEME_STORAGE_KEY}');
    mode = localStorage.getItem('${MODE_STORAGE_KEY}');
  } catch (e) {
    // Storage blocked (private mode, sandboxed frame): defaults below.
  }
  if (ids.indexOf(theme) < 0) theme = '${defaultId}';
  if (mode !== 'light' && mode !== 'dark') {
    var dark = false;
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      // No matchMedia: stay light.
    }
    mode = dark ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
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

function main() {
  const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const errors = validate(source);
  if (errors.length) fail('themes.json is invalid', errors);

  const { derived, failures } = deriveAll(source.themes);
  if (failures.length) fail('Theme contrast check failed (WCAG AA)', failures);

  const outputs = [
    [OUT_SCSS, renderScss(source.themes, source.default, derived)],
    [OUT_TS, renderRegistry(source.themes, source.default, derived)],
    [OUT_BOOT, renderBoot(source.themes, source.default)],
  ];
  const changed = outputs.filter(([file, content]) => writeIfChanged(file, content));

  if (process.argv.includes('--table')) {
    console.table(
      source.themes.map((t) => ({
        id: t.id,
        body: t.fontBody,
        heading: t.fontHeading,
        light: derived[t.id].light.accent,
        dark: derived[t.id].dark.accent,
      })),
    );
  }
  const summary = changed.length
    ? `wrote ${changed.map(([file]) => basename(file)).join(', ')}`
    : 'outputs unchanged';
  console.log(
    `themes -> ${source.themes.length} themes x ${MODES.length} modes pass WCAG AA; ${summary}`,
  );
}

main();
