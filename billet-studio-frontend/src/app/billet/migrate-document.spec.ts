import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createDocument, type BilletDocument } from './billet-document';
import { migrateDocument } from './migrate-document';

/** The live Mother's Day card, shared with the backend tests and the parity test. */
function fixture(): BilletDocument {
  const file = join('..', 'docs', 'fixtures', 'muttertag.billet.json');
  return JSON.parse(readFileSync(file, 'utf8')) as BilletDocument;
}

describe('migrateDocument', () => {
  it('returns null for anything that is not a billet document of a known version', () => {
    const garbage = [
      null,
      undefined,
      'x',
      42,
      [],
      {},
      { schemaVersion: '1' },
      { schemaVersion: 2 },
    ];
    expect(garbage.map(migrateDocument)).toEqual(garbage.map(() => null));
  });

  it('keeps the reference document exactly as it is', () => {
    expect(migrateDocument(fixture())).toEqual(fixture());
  });

  it('completes a bare document with the values of a new one', () => {
    expect(migrateDocument({ schemaVersion: 1, lang: 'en', theme: 'sage' })).toEqual(
      createDocument({ lang: 'en', themeId: 'sage' }),
    );
  });

  it('repairs invalid values, enforces the limits and drops unknown keys', () => {
    const input = fixture() as unknown as Record<string, unknown> & BilletDocument;
    input['theme'] = 'retired-theme';
    input['extra'] = { anything: true };
    input.title = ' \t ';
    input.hero.sub = `von\tAndreas\r\n${'x'.repeat(200)}`;
    input.typography.heading.fontId = 'comic-sans';
    input.scene.height = 99;
    input.scene.fitSize = 1.234;
    input.particles.density = 50.6;
    input.particles.colors = ['#ABCDEF', 'red', '#12345'];
    (input.scene as unknown as Record<string, unknown>)['exposure'] = '1.5';
    const [b1, b2, b3] = input.blocks;
    input.blocks = [
      { ...b1, icon: '🌸', dividerStyle: 'star', spaceAdjust: -9 },
      { ...b2, id: 'b1' },
      { ...b3, type: 'poem' as never },
      ...Array.from({ length: 40 }, (_, i) => ({ ...b2, id: `n${i}`, text: 'x' })),
    ];

    const result = migrateDocument(input)!;

    expect(result.theme).toBe('rose');
    expect(result.title).toBe('Mein Billet');
    expect(result.hero.sub).toBe(`von Andreas\n${'x'.repeat(108)}`);
    expect(result.typography.heading).toEqual({
      fontId: 'cormorant-garamond',
      weight: 400,
      italic: false,
      size: 1,
    });
    expect(result.scene).toMatchObject({ height: 40, fitSize: 1.23, exposure: 0.6 });
    expect(result.particles).toMatchObject({ density: 51, colors: ['#abcdef'] });
    expect(result.blocks).toHaveLength(30);
    expect(result.blocks[0]).toMatchObject({
      id: 'b1',
      icon: '',
      dividerStyle: 'none',
      spaceAdjust: -6,
    });
    expect(result.blocks[1].id).toMatch(/^b-[0-9a-f]{12}$/);
    expect(result.blocks[2].id).toBe('n0');
    expect(Object.keys(result)).toEqual(Object.keys(createDocument({ lang: 'de' })));
  });
});
