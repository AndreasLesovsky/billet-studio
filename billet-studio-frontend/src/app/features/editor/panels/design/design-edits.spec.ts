import { describe, expect, it } from 'vitest';

import { applyThemePreset, createDocument } from '../../../../billet/billet-document';
import { deriveDarkPalette } from '../../../../billet/palette';
import {
  matchesThemePreset,
  withDarkLinked,
  withLightColor,
  withRoleFont,
  withRoleWeight,
  withTypographyOf,
} from './design-edits';

describe('design edits', () => {
  const fresh = () => createDocument({ lang: 'de' });

  it('a light colour derives the dark palette again while linked, and never touches it unlinked', () => {
    const { palette } = fresh();

    const linked = withLightColor({ ...palette, darkLinked: true }, 'accent', '#3366cc');
    expect(linked.light).toEqual({ ...palette.light, accent: '#3366cc' });
    expect(linked.dark).toEqual(deriveDarkPalette(linked.light));

    const unlinked = withLightColor(palette, 'accent', '#3366cc');
    expect(unlinked.light.accent).toBe('#3366cc');
    expect(unlinked.dark).toBe(palette.dark);
  });

  it('linking derives the dark palette at once; unlinking keeps the derived colours to edit', () => {
    const { palette } = fresh();
    const linked = withDarkLinked(palette, true);
    expect(linked.dark).toEqual(deriveDarkPalette(palette.light));

    const unlinked = withDarkLinked(linked, false);
    expect(unlinked.darkLinked).toBe(false);
    expect(unlinked.dark).toBe(linked.dark);
  });

  it('another family takes its nearest shipped weight, and italic only where it has one', () => {
    // Rosé: the signature is Cormorant Garamond 300 italic.
    const { typography } = fresh();

    // Merriweather ships 300 but no italic at all.
    const merriweather = withRoleFont(typography, 'signature', 'merriweather');
    expect(merriweather.signature).toMatchObject({ weight: 300, italic: false });
    // Libre Baskerville ships 400 and 700, italic at 400 only.
    const baskerville = withRoleFont(typography, 'signature', 'libre-baskerville');
    expect(baskerville.signature).toMatchObject({ weight: 400, italic: true });
    expect(baskerville.title).toBe(typography.title);

    expect(withRoleWeight(baskerville, 'signature', 700).signature.italic).toBe(false);
    expect(withRoleFont(typography, 'signature', 'cormorant-garamond')).toBe(typography);
  });

  it('the theme reset is idle only while colours, fonts and particle colours are the preset', () => {
    const document = fresh();
    expect(matchesThemePreset(document)).toBe(true);
    expect(matchesThemePreset(applyThemePreset(document, 'ocean'))).toBe(true);

    const recoloured = { ...document, palette: withLightColor(document.palette, 'ink', '#000000') };
    expect(matchesThemePreset(recoloured)).toBe(false);
    const linked = { ...document, palette: withDarkLinked(document.palette, true) };
    expect(matchesThemePreset(linked)).toBe(false);
    expect(matchesThemePreset(withTypographyOf(document, 'ocean'))).toBe(false);
    const particles = { ...document.particles, colors: document.particles.colors.slice(1) };
    expect(matchesThemePreset({ ...document, particles })).toBe(false);
  });
});
