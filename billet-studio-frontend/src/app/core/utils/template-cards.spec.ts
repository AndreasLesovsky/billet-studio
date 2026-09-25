import { describe, expect, it } from 'vitest';

import { TEMPLATES } from '../../billet/templates/templates';
import type { CatalogPreviews } from './model-previews';
import { templateCards } from './template-cards';

describe('templateCards', () => {
  it('shimmers while the catalog loads, then shows the preview, and the emoji only without one', () => {
    const slug = TEMPLATES.muttertag.modelSlug;
    const cases: [string, CatalogPreviews, string][] = [
      ['catalog loading', 'loading', 'shimmer'],
      ['catalog failed', 'failed', 'emoji'],
      ['model not in the catalog', new Map([['some-other-model', 'https://cdn/o.webp']]), 'emoji'],
      ['model without a preview', new Map([[slug, '']]), 'emoji'],
      ['model with a preview', new Map([[slug, 'https://cdn/p.webp']]), 'https://cdn/p.webp'],
    ];

    const shown = cases.map(([label, catalog]) => {
      const { preview } = templateCards(catalog).find((card) => card.id === 'muttertag')!;
      return [label, preview.pending ? 'shimmer' : (preview.src ?? 'emoji')];
    });

    expect(shown).toEqual(cases.map(([label, , expected]) => [label, expected]));
  });
});
