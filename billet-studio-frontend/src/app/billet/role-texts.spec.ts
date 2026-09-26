import { describe, expect, it } from 'vitest';

import { createDocument } from './billet-document';
import { roleSamples } from './role-texts';

describe('role samples', () => {
  it('a sample is the role text as plain text on one line, cut at a word boundary', () => {
    const document = createDocument({ templateId: 'valentinstag', lang: 'de' });
    const samples = roleSamples({
      ...document,
      hero: { ...document.hero, titleLine1: 'Ich *liebe*  **dich**\n\nund\nuns' },
      blocks: [
        {
          ...document.blocks[0],
          text: 'Mit dir fühlt sich selbst ein ganz gewöhnlicher Dienstag wie ein Fest an.',
        },
      ],
    });

    expect(samples.title).toBe('Ich liebe dich und uns');
    expect(samples.body).toBe('Mit dir fühlt sich selbst ein ganz…');
  });
});
