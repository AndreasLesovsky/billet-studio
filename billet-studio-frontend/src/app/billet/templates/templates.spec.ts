import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';

import { BILLET_LANGS, createDocument } from '../billet-document';
import { migrateDocument } from '../migrate-document';
import { TEMPLATE_IDS } from './templates';

/** Active models of the catalog seed: slug -> scene defaults in ModelDefaultsDto order. */
function seededModels(): Map<string, number[]> {
  const sql = readFileSync(join('..', 'sql', 'seed_models.sql'), 'utf8');
  const row =
    /\('([a-z0-9-]+)',(?: '[^']*',){5} \d+, ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), '(?:[^']|'')*', \d+, 1,/g;
  return new Map([...sql.matchAll(row)].map(([, slug, ...numbers]) => [slug, numbers.map(Number)]));
}

describe('templates', () => {
  it('every template makes a complete document within every limit, on an active seeded model', () => {
    const models = seededModels();
    const failures = TEMPLATE_IDS.flatMap((templateId) =>
      BILLET_LANGS.flatMap((lang) => {
        const document = createDocument({ templateId, lang });
        const { scene } = document;
        const seed = models.get(scene.modelSlug);
        const defaults = [
          scene.fitSize,
          scene.yOffset,
          scene.exposure,
          scene.cameraDistance,
          scene.cameraHeight,
          scene.autoRotateSpeed,
        ];
        return [
          // migrateDocument repairs whatever breaks a limit, so an untouched document is within all.
          ...(isDeepStrictEqual(migrateDocument(document), document)
            ? []
            : [`${templateId}/${lang}: outside the limits`]),
          ...(seed && seed.join() === defaults.join()
            ? []
            : [`${templateId}: ${scene.modelSlug} is not an active seed with these defaults`]),
        ];
      }),
    );

    expect(failures).toEqual([]);
  });
});
