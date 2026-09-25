import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { migrateDocument } from '../migrate-document';
import { billetRootStyle, blockSpaces, resolveBilletMode } from './billet-view-style';

/** The live Mother's Day card (docs/fixtures, the parity reference). */
const LIVE_CARD = migrateDocument(
  JSON.parse(readFileSync(join('..', 'docs', 'fixtures', 'muttertag.billet.json'), 'utf8')),
)!;

describe('billet-view-style', () => {
  it('binds the palette of the resolved mode: auto follows the system, explicit modes win', () => {
    const { light, dark } = LIVE_CARD.palette;
    const style = (mode: 'auto' | 'light' | 'dark', systemDark: boolean) =>
      billetRootStyle(LIVE_CARD, resolveBilletMode(mode, systemDark));

    expect(style('auto', false)).toMatchObject({
      'color-scheme': 'light',
      '--billet-background': light.background,
      '--billet-accent-soft': light.accentSoft,
    });
    expect(style('auto', true)).toMatchObject({
      'color-scheme': 'dark',
      '--billet-background': dark.background,
      '--billet-ink': dark.ink,
    });
    expect(style('light', true)['--billet-surface']).toBe(light.surface);
    expect(style('dark', false)['--billet-border']).toBe(dark.border);
  });

  it('maps the spacing steps to the live card rem values', () => {
    expect(billetRootStyle(LIVE_CARD, 'light')).toMatchObject({
      '--billet-space-gutter': '2rem',
      '--billet-space-hero-top': '4.5rem',
      '--billet-space-hero-bottom': '4rem',
      '--billet-space-divider': '2.25rem',
      '--billet-space-signature': '3rem',
      '--billet-space-page-bottom': '5rem',
    });
  });

  it('spaces blocks by blockGap plus their adjustment; the first only by its own, clamped', () => {
    // The live card: two sections 2.5rem apart, the card 2.5rem, the note 2.25rem (spaceAdjust -1).
    expect(blockSpaces(LIVE_CARD.blocks, LIVE_CARD.spacing.blockGap)).toEqual([
      '0rem',
      '2.5rem',
      '2.5rem',
      '2.25rem',
    ]);
    const adjusted = [{ spaceAdjust: -3 }, { spaceAdjust: 6 }, { spaceAdjust: -6 }];
    expect(blockSpaces(adjusted, 16)).toEqual(['0rem', '8rem', '2.5rem']);
  });
});
