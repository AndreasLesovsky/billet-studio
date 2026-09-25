import { describe, expect, it } from 'vitest';

import { fitZoom, nextZoomStep, parseZoomSetting, previousZoomStep } from './zoom-steps';

// The phone frame (390 × 844 screen plus its bezel) and the desktop frame, in px.
const PHONE = { width: 410, height: 864 };
const DESKTOP = { width: 1040, height: 700 };

const CASES: readonly (readonly [string, () => unknown, unknown])[] = [
  ['zoom in from a fitted 73 % goes to the next step, 75 %', () => nextZoomStep(0.7312), 75],
  ['zoom out from a fitted 73 % goes to the step below, 67 %', () => previousZoomStep(0.7312), 67],
  ['a fit shown as 75 % zooms in past 75 %', () => nextZoomStep(0.748), 90],
  ['a fit shown as 75 % zooms out past 75 %', () => previousZoomStep(0.748), 67],
  ['zoom in from 100 % goes to 110 %', () => nextZoomStep(1), 110],
  ['zoom in stops at 200 %', () => nextZoomStep(2), null],
  ['zoom out stops at 25 %', () => previousZoomStep(0.25), null],
  [
    'a phone that fits is shown at 100 %',
    () => fitZoom({ width: 600, height: 900 }, PHONE, true),
    1,
  ],
  [
    'a phone taller than the stage is scaled to its height',
    () => fitZoom({ width: 600, height: 648 }, PHONE, true),
    0.75,
  ],
  [
    'a phone wider than the stage is scaled to its width',
    () => fitZoom({ width: 307.5, height: 900 }, PHONE, true),
    0.75,
  ],
  [
    'the desktop frame fits the width and ignores the height',
    () => fitZoom({ width: 520, height: 200 }, DESKTOP, false),
    0.5,
  ],
  [
    'fit rounds down, never overflowing',
    () => fitZoom({ width: 300, height: 900 }, PHONE, true),
    0.731,
  ],
  ['fit never goes below 25 %', () => fitZoom({ width: 50, height: 50 }, PHONE, true), 0.25],
  ['a stored step is read back', () => parseZoomSetting('150'), 150],
  ['a stored "fit" is fit', () => parseZoomSetting('fit'), 'fit'],
  ['nothing stored is fit', () => parseZoomSetting(null), 'fit'],
  ['a value that is no step is fit', () => parseZoomSetting('42'), 'fit'],
];

describe('zoom steps', () => {
  it.each(CASES)('%s', (_, run, expected) => {
    expect(run()).toEqual(expected);
  });
});
