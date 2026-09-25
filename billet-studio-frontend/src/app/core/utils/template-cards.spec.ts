import { describe, expect, it } from 'vitest';

import { TEMPLATES } from '../../billet/templates/templates';
import type { ModelAssetDto } from '../models/models';
import { templateCards } from './template-cards';

describe('templateCards', () => {
  it('shows the model preview only once the catalog has one for the template model', () => {
    const slug = TEMPLATES.muttertag.modelSlug;
    const model = (modelSlug: string, previewUrl: string): ModelAssetDto =>
      ({ slug: modelSlug, previewUrl }) as ModelAssetDto;
    const cases: [string, readonly ModelAssetDto[] | null, string | null][] = [
      ['catalog loading or unreachable', null, null],
      ['model not in the catalog', [model('some-other-model', 'https://cdn/other.webp')], null],
      ['model without a preview', [model(slug, '')], null],
      [
        'model with a preview',
        [model(slug, 'https://cdn/preview.webp')],
        'https://cdn/preview.webp',
      ],
    ];

    const previews = cases.map(([label, models]) => [
      label,
      templateCards(models).find((card) => card.id === 'muttertag')?.previewUrl,
    ]);

    expect(previews).toEqual(cases.map(([label, , expected]) => [label, expected]));
  });
});
