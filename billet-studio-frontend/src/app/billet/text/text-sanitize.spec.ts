import { describe, expect, it } from 'vitest';

import { sanitizeText, truncateGraphemes } from './text-sanitize';

describe('text hygiene', () => {
  it('keeps only what the backend accepts: \\n, no other control, no half emoji, NFC', () => {
    const cases: [input: string, expected: string][] = [
      ['eins\r\nzwei\rdrei', 'eins\nzweidrei'],
      ['a\tb\t\tc', 'a b  c'],
      ['a\u0000b\u0007c\u001bd\u007fe\u000bf\u000cg', 'abcdefg'],
      ['bleibt\nso', 'bleibt\nso'],
      ['Café', 'Café'],
      ['halb \ud83e ganz 🦁', 'halb  ganz 🦁'],
      ['\udc00x', 'x'],
    ];
    expect(cases.map(([input]) => sanitizeText(input))).toEqual(cases.map(([, out]) => out));
  });

  it('shortens to UTF-16 units at grapheme boundaries only', () => {
    const family = '👨‍👩‍👧'; // 8 units, one grapheme
    const cases: [text: string, max: number, expected: string][] = [
      ['kurz', 10, 'kurz'],
      ['abcdef', 3, 'abc'],
      [`ab${family}cd`, 9, 'ab'],
      [`ab${family}cd`, 10, `ab${family}`],
      ['🇩🇪🇦🇹', 6, '🇩🇪'],
      ['éé', 3, 'é'],
      ['🦁🦁', 3, '🦁'],
    ];
    expect(cases.map(([text, max]) => truncateGraphemes(text, max))).toEqual(
      cases.map(([, , out]) => out),
    );
  });
});
