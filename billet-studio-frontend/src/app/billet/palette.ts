import type { BilletPalette, HexColor } from './billet-document';

// Colour math for billet palettes: sRGB <-> OKLCH (Björn Ottosson), WCAG 2.x contrast. The same
// formulas as scripts/generate-themes.mjs, which checks the theme presets against the same rules.

export interface Oklch {
  /** Lightness 0..1. */
  l: number;
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

type Rgb = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex: HexColor): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex(rgb: Rgb): HexColor {
  const channel = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(channel).join('')}`;
}

export function hexToOklch(hex: HexColor): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
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

const inGamut = (linear: Rgb) => linear.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Out-of-gamut colours keep lightness and hue and lose chroma. */
export function oklchToHex({ l, c, h }: Oklch): HexColor {
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
  return toHex(linear.map((v) => fromLinear(clamp(v, 0, 1))) as Rgb);
}

function luminance(hex: HexColor): number {
  const [r, g, b] = parseHex(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: HexColor, b: HexColor): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type PaletteKey = keyof BilletPalette;

/** What every billet palette must meet: text 4.5:1, accent marks 3:1 (as the theme generator). */
const CONTRAST_RULES: readonly (readonly [fg: PaletteKey, bg: PaletteKey, min: number])[] = [
  ['ink', 'background', 4.5],
  ['ink', 'surface', 4.5],
  ['inkSoft', 'background', 4.5],
  ['accent', 'accentSoft', 3],
  ['accent', 'background', 3],
];

export interface ContrastIssue {
  readonly fg: PaletteKey;
  readonly bg: PaletteKey;
  readonly min: number;
  readonly ratio: number;
}

/** The rules a palette breaks; empty when it is readable. */
export function contrastIssues(palette: BilletPalette): ContrastIssue[] {
  return CONTRAST_RULES.map(([fg, bg, min]) => ({
    fg,
    bg,
    min,
    ratio: contrast(palette[fg], palette[bg]),
  })).filter((rule) => rule.ratio < rule.min);
}

/** Raises the lightness of `hex` in small steps until `ok` holds (white always ends it). */
function lightenUntil(hex: HexColor, ok: (candidate: HexColor) => boolean): HexColor {
  const base = hexToOklch(hex);
  let candidate = hex;
  for (let l = base.l; !ok(candidate) && l < 1;) {
    l = Math.min(1, l + 0.01);
    candidate = oklchToHex({ ...base, l });
  }
  return candidate;
}

/** Below this OKLCH chroma a colour reads as grey, and its hue is noise. */
const ACHROMATIC = 0.004;

/**
 * The night version of a light palette: every role keeps its own hue at night lightness - deep
 * planes, light inks, a lighter accent - and a grey borrows a trace of the accent's hue. Then each
 * contrast rule is enforced by lightening the part that fails it.
 */
export function deriveDarkPalette(light: BilletPalette): BilletPalette {
  const accent = hexToOklch(light.accent);
  const night = (hex: HexColor, l: number, chromaScale: number, cap: number) => {
    const own = hexToOklch(hex);
    const tinted = own.c >= ACHROMATIC;
    return oklchToHex({
      l,
      c: Math.min(tinted ? own.c * chromaScale : accent.c * 0.1, cap),
      h: tinted ? own.h : accent.h,
    });
  };

  const background = night(light.background, 0.18, 1.5, 0.022);
  const surface = night(light.background, 0.215, 1.5, 0.024);
  const accentSoft = night(light.accentSoft, 0.235, 1.5, 0.035);
  const border = night(light.border, 0.36, 1, 0.05);
  const ink = lightenUntil(
    night(light.ink, 0.94, 0.6, 0.015),
    (x) => contrast(x, background) >= 4.5 && contrast(x, surface) >= 4.5,
  );
  const inkSoft = lightenUntil(
    night(light.inkSoft, 0.78, 1.2, 0.05),
    (x) => contrast(x, background) >= 4.5,
  );
  const nightAccent = lightenUntil(
    oklchToHex({ ...accent, l: clamp(accent.l + 0.12, 0.72, 0.9) }),
    (x) => contrast(x, accentSoft) >= 3 && contrast(x, background) >= 3,
  );
  return { accent: nightAccent, accentSoft, border, background, ink, inkSoft, surface };
}

export type BilletPaletteVar =
  | '--billet-accent'
  | '--billet-accent-soft'
  | '--billet-border'
  | '--billet-background'
  | '--billet-ink'
  | '--billet-ink-soft'
  | '--billet-surface';

/** The palette as the billet root's custom properties. */
export function paletteToCssVars(palette: BilletPalette): Record<BilletPaletteVar, string> {
  return {
    '--billet-accent': palette.accent,
    '--billet-accent-soft': palette.accentSoft,
    '--billet-border': palette.border,
    '--billet-background': palette.background,
    '--billet-ink': palette.ink,
    '--billet-ink-soft': palette.inkSoft,
    '--billet-surface': palette.surface,
  };
}
