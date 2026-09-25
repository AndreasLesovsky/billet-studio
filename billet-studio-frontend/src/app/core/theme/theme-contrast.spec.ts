import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FONT_BY_ID, type FontCatalogEntry } from '../../billet/fonts/font-catalog.generated';
import { BILLET_THEME_PRESETS, type BilletThemePreset } from './billet-theme-presets.generated';
import {
  COLOR_MODE_STORAGE_KEY,
  SITE_COLOR_TOKENS,
  SITE_THEME,
  THEME_COLOR_TOKENS,
  THEME_IDS,
  THEMES,
  type ColorMode,
  type ThemeColorTokens,
} from './theme-registry.generated';

/**
 * Guard for section 9 of CLAUDE.md: the site theme and every editor theme pass WCAG AA in both
 * modes, and every editor theme's billet preset is readable and uses shipped font faces.
 * generate-themes.mjs already refuses to write a failing theme; this re-checks the generated
 * values independently, so a hand-edited or stale generated file fails the test run as well.
 */

type Pair = readonly [fg: keyof ThemeColorTokens, bg: keyof ThemeColorTokens, min: number];

type BilletPaletteKey = keyof BilletThemePreset['palette']['light'];

const TEXT = 4.5;
const UI = 3;

const BILLET_PAIRS: readonly (readonly [BilletPaletteKey, BilletPaletteKey, number])[] = [
  ['ink', 'background', TEXT],
  ['ink', 'surface', TEXT],
  ['inkSoft', 'background', TEXT],
  ['accent', 'accentSoft', UI],
  ['accent', 'background', UI],
];

const FONT_ROLES = ['title', 'titleAccent', 'heading', 'body', 'signature', 'ui'] as const;

/** The parts of docs/fixtures/muttertag.billet.json a theme preset covers. */
interface OriginalCard {
  readonly palette: BilletThemePreset['palette'];
  readonly typography: BilletThemePreset['typography'];
  readonly particles: { readonly colors: readonly string[] };
}

const PAIRS: readonly Pair[] = [
  ['text', 'bg', TEXT],
  ['text', 'surface', TEXT],
  ['text', 'surfaceRaised', TEXT],
  ['text', 'surfaceSunken', TEXT],
  ['text', 'accentSoft', TEXT],
  ['textMuted', 'bg', TEXT],
  ['textMuted', 'surface', TEXT],
  ['textMuted', 'surfaceRaised', TEXT],
  ['textMuted', 'surfaceSunken', TEXT],
  ['textSubtle', 'bg', UI],
  ['textSubtle', 'surface', UI],
  ['borderStrong', 'bg', UI],
  ['borderStrong', 'surface', UI],
  ['onAccent', 'accent', TEXT],
  ['onAccent', 'accentHover', TEXT],
  ['accentInk', 'bg', TEXT],
  ['accentInk', 'surface', TEXT],
  ['accentInk', 'surfaceRaised', TEXT],
  ['accentInk', 'accentSoft', TEXT],
  ['accent', 'bg', UI],
  ['accent', 'surface', UI],
  ['focusRing', 'bg', UI],
  ['focusRing', 'surface', UI],
  ['focusRing', 'surfaceRaised', UI],
  ['danger', 'bg', UI],
  ['danger', 'surface', UI],
  ['onDanger', 'danger', TEXT],
  ['onDanger', 'dangerHover', TEXT],
  ['dangerInk', 'bg', TEXT],
  ['dangerInk', 'surface', TEXT],
  ['dangerInk', 'dangerSoft', TEXT],
  ['successInk', 'surface', TEXT],
  ['successInk', 'successSoft', TEXT],
  ['warningInk', 'surface', TEXT],
  ['warningInk', 'warningSoft', TEXT],
  ['infoInk', 'surface', TEXT],
  ['infoInk', 'infoSoft', TEXT],
  ['onSuccess', 'success', TEXT],
  ['onWarning', 'warning', TEXT],
  ['onInfo', 'info', TEXT],
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MODES: readonly ColorMode[] = ['light', 'dark'];

describe('theme contrast and billet presets', () => {
  it('computes WCAG contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('has colour tokens and picker metadata for every theme id', () => {
    expect(Object.keys(THEME_COLOR_TOKENS)).toEqual([...THEME_IDS]);
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  const tokenSets = [
    [SITE_THEME, SITE_COLOR_TOKENS],
    ...THEME_IDS.map((id) => [id, THEME_COLOR_TOKENS[id]] as const),
  ] as const;

  for (const [id, byMode] of tokenSets) {
    for (const mode of MODES) {
      it(`${id} / ${mode} passes every pair`, () => {
        const tokens = byMode[mode];
        const failures = PAIRS.filter(
          ([fg, bg, min]) => contrast(tokens[fg], tokens[bg]) < min,
        ).map(
          ([fg, bg, min]) =>
            `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)} < ${min}`,
        );
        expect(failures).toEqual([]);
      });
    }
  }

  it('theme-boot.js sets only the site theme and reads only the colour mode', () => {
    const boot = readFileSync(join('public', 'theme-boot.js'), 'utf8');
    const themes = [...boot.matchAll(/'data-theme', '([a-z0-9]+)'/g)].map((m) => m[1]);
    const keys = [...boot.matchAll(/getItem\('([^']+)'\)/g)].map((m) => m[1]);

    expect(themes).toEqual([SITE_THEME]);
    expect(keys).toEqual([COLOR_MODE_STORAGE_KEY]);
    expect(THEME_IDS).not.toContain(SITE_THEME);
  });

  it("the rose billet preset is the original Mother's Day card", () => {
    const fixture = join('..', 'docs', 'fixtures', 'muttertag.billet.json');
    const card = JSON.parse(readFileSync(fixture, 'utf8')) as OriginalCard;

    expect(BILLET_THEME_PRESETS.rose).toEqual({
      palette: { light: card.palette.light, dark: card.palette.dark },
      typography: card.typography,
      particleColors: card.particles.colors,
    });
  });

  it('every billet preset is readable in both modes and uses shipped font faces', () => {
    const fonts: ReadonlyMap<string, FontCatalogEntry> = FONT_BY_ID;
    const failures = THEME_IDS.flatMap((id) => {
      const { palette, typography } = BILLET_THEME_PRESETS[id];
      const unreadable = MODES.flatMap((mode) =>
        BILLET_PAIRS.filter(
          ([fg, bg, min]) => contrast(palette[mode][fg], palette[mode][bg]) < min,
        ).map(([fg, bg]) => `${id}/${mode}: ${fg} on ${bg}`),
      );
      const unshipped = FONT_ROLES.filter((role) => {
        const { fontId, weight, italic } = typography[role];
        const font = fonts.get(fontId);
        return !(italic ? font?.italicWeights : font?.weights)?.includes(weight);
      }).map((role) => `${id}: ${role} ${typography[role].fontId} ${typography[role].weight}`);
      return [...unreadable, ...unshipped];
    });

    expect(failures).toEqual([]);
  });
});
