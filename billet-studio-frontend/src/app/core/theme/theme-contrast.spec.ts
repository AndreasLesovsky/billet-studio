import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_THEME,
  THEME_COLOR_TOKENS,
  THEME_IDS,
  THEME_STORAGE_KEY,
  THEMES,
  type ColorMode,
  type ThemeColorTokens,
} from './theme-registry.generated';

/**
 * Guard for section 9 of CLAUDE.md: every theme x mode passes WCAG AA. generate-themes.mjs already
 * refuses to write a failing theme; this re-checks the generated values independently, so a
 * hand-edited or stale generated file fails the test run as well.
 */

type Pair = readonly [fg: keyof ThemeColorTokens, bg: keyof ThemeColorTokens, min: number];

const TEXT = 4.5;
const UI = 3;

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

describe('theme contrast (WCAG AA)', () => {
  it('computes WCAG contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('has colour tokens and picker metadata for every theme id', () => {
    expect(Object.keys(THEME_COLOR_TOKENS)).toEqual([...THEME_IDS]);
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  for (const id of THEME_IDS) {
    for (const mode of MODES) {
      it(`${id} / ${mode} passes every pair`, () => {
        const tokens = THEME_COLOR_TOKENS[id][mode];
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

  it('theme-boot.js knows exactly the registry theme ids, the default and the storage keys', () => {
    const boot = readFileSync(join('public', 'theme-boot.js'), 'utf8');
    const list = /var ids = \[([^\]]*)\]/.exec(boot)?.[1] ?? '';
    const ids = [...list.matchAll(/['"]([a-z0-9]+)['"]/g)].map((m) => m[1]);

    expect(ids).toEqual([...THEME_IDS]);
    expect(boot).toMatch(new RegExp(`theme = ['"]${DEFAULT_THEME}['"]`));
    expect(boot).toContain(THEME_STORAGE_KEY);
    expect(boot).toContain(COLOR_MODE_STORAGE_KEY);
  });
});
