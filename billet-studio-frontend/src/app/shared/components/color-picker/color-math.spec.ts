import { describe, expect, it } from 'vitest';

import { hexToHsv, hsvAfterKey, hsvToHex, parseHexInput } from './color-math';

describe('color math', () => {
  it.each([
    ['#c8614a', '#c8614a'],
    ['#C8614A', '#c8614a'],
    ['c8614a', '#c8614a'],
    ['#abc', '#aabbcc'],
    ['ABC', '#aabbcc'],
    ['  #0f0 ', '#00ff00'],
    ['', null],
    ['#abcd', null],
    ['#1234567', null],
    ['##abc', null],
    ['#ggg', null],
    ['#ab c', null],
  ])('reads the hex input %j as %j', (text, expected) => {
    expect(parseHexInput(text)).toBe(expected);
  });

  it.each([
    ['#ff0000', { h: 0, s: 100, v: 100 }],
    ['#0000ff', { h: 240, s: 100, v: 100 }],
    ['#ffffff', { h: 0, s: 0, v: 100 }],
    ['#000000', { h: 0, s: 0, v: 0 }],
  ])('maps %s to HSV %j', (hex, hsv) => {
    expect(hexToHsv(hex)).toEqual(hsv);
  });

  it.each(['#c8614a', '#fdf5f2', '#2a1f1a', '#6246ea', '#9d8cff', '#010203', '#7f7f7f', '#fefefe'])(
    'round-trips %s through HSV unchanged',
    (hex) => {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    },
  );

  it('wraps the hue and clamps saturation and brightness', () => {
    expect(hsvToHex({ h: 360, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: -120, s: 100, v: 100 })).toBe('#0000ff');
    expect(hsvToHex({ h: 0, s: 140, v: -5 })).toBe('#000000');
  });

  it.each([
    ['plane', 'ArrowRight', false, { h: 10, s: 51, v: 50 }],
    ['plane', 'ArrowLeft', true, { h: 10, s: 40, v: 50 }],
    ['plane', 'ArrowUp', false, { h: 10, s: 50, v: 51 }],
    ['plane', 'PageDown', true, { h: 10, s: 50, v: 40 }],
    ['plane', 'End', false, { h: 10, s: 100, v: 50 }],
    ['hue', 'ArrowDown', false, { h: 9, s: 50, v: 50 }],
    ['hue', 'ArrowRight', true, { h: 20, s: 50, v: 50 }],
    ['hue', 'PageDown', false, { h: 0, s: 50, v: 50 }],
    ['hue', 'End', false, { h: 360, s: 50, v: 50 }],
    ['hue', 'Enter', false, null],
  ] as const)('moves the %s on %s (shift %s) to %j', (channel, key, big, expected) => {
    expect(hsvAfterKey({ h: 10, s: 50, v: 50 }, channel, key, big)).toEqual(expected);
  });
});
