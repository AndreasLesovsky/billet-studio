import { describe, expect, it } from 'vitest';

import { parseInlineMarkup, type InlineNode } from './inline-markup';

const t = (text: string): InlineNode => ({ type: 'text', text });
const em = (...children: InlineNode[]): InlineNode => ({ type: 'em', children });
const strong = (...children: InlineNode[]): InlineNode => ({ type: 'strong', children });
const br: InlineNode = { type: 'break' };

describe('parseInlineMarkup', () => {
  const cases: [name: string, input: string, paragraphs: InlineNode[][]][] = [
    ['plain text', 'Hallo Mama', [[t('Hallo Mama')]]],
    ['emphasis', 'ich *bewundere* dich', [[t('ich '), em(t('bewundere')), t(' dich')]]],
    ['strong', '**Nockerl** oder', [[strong(t('Nockerl')), t(' oder')]]],
    ['em inside strong', '**a *b* c**', [[strong(t('a '), em(t('b')), t(' c'))]]],
    ['strong inside em', '*a **b** c*', [[em(t('a '), strong(t('b')), t(' c'))]]],
    ['three stars', '***beides***', [[em(strong(t('beides')))]]],
    ['two runs in a row', '**a** und **b**', [[strong(t('a')), t(' und '), strong(t('b'))]]],
    ['unclosed marker stays literal', 'a *b', [[t('a *b')]]],
    ['unopened strong stays literal', 'b** c', [[t('b** c')]]],
    ['spaced stars are not markup', '5 * 3 * 2', [[t('5 * 3 * 2')]]],
    ['a lone star run stays literal', '****', [[t('****')]]],
    ['line break', 'eins\nzwei', [[t('eins'), br, t('zwei')]]],
    ['emphasis across a line break', '*eins\nzwei*', [[em(t('eins'), br, t('zwei'))]]],
    ['blank line = paragraph', 'eins\n\nzwei', [[t('eins')], [t('zwei')]]],
    ['whitespace-only lines are one gap', 'eins\n \n\n\t\nzwei', [[t('eins')], [t('zwei')]]],
    ['leading and trailing blank lines vanish', '\n\neins\n\n', [[t('eins')]]],
    ['no markup across paragraphs', '*eins\n\nzwei*', [[t('*eins')], [t('zwei*')]]],
    ['emoji and ZWJ sequences stay whole', '*🦁* 👨‍👩‍👧 🇩🇪', [[em(t('🦁')), t(' 👨‍👩‍👧 🇩🇪')]]],
    ['HTML is text', '<b>fett</b> & <br>', [[t('<b>fett</b> & <br>')]]],
    ['empty text', '', []],
  ];

  for (const [name, input, paragraphs] of cases) {
    it(`${name}: ${JSON.stringify(input)}`, () => {
      expect(parseInlineMarkup(input)).toEqual(paragraphs);
    });
  }
});
