import { describe, expect, it } from 'vitest';

import { BILLET_THEME_PRESETS } from '../core/theme/billet-theme-presets.generated';
import { THEME_IDS } from '../core/theme/theme-registry.generated';
import { contrast, contrastIssues, deriveDarkPalette, hexToOklch } from './palette';

describe('deriveDarkPalette', () => {
  it('turns every theme preset into a readable night palette', () => {
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);

    const failures = THEME_IDS.flatMap((id) => {
      const light = BILLET_THEME_PRESETS[id].palette.light;
      const dark = deriveDarkPalette(light);
      const broken = contrastIssues(dark).map(
        ({ fg, bg, ratio, min }) => `${id}: ${fg} on ${bg} ${ratio.toFixed(2)} < ${min}`,
      );
      const night = hexToOklch(dark.background).l < 0.25 && hexToOklch(dark.ink).l > 0.85;
      const lighterAccent = hexToOklch(dark.accent).l > hexToOklch(light.accent).l;
      return [
        ...broken,
        ...(night ? [] : [`${id}: not a night palette`]),
        ...(lighterAccent ? [] : [`${id}: accent not lighter`]),
      ];
    });

    expect(failures).toEqual([]);
  });
});
