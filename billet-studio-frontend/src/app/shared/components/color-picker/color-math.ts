// Colour math of the colour picker: '#rrggbb' <-> HSV. Hue in degrees 0..360, saturation and value
// (brightness) in percent 0..100, unrounded - the picker keeps its own HSV, so dragging through grey
// or black keeps the hue. Contrast lives in billet/palette.ts.

export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/** What the hex field accepts: #rgb or #rrggbb, the '#' optional, any case, surrounding space. */
export const HEX_INPUT_PATTERN = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** A hex colour as typed or stored, normalised to '#rrggbb' lowercase; null when it is none. */
export function parseHexInput(text: string): string | null {
  const digits = HEX_INPUT_PATTERN.exec(text)?.[1].toLowerCase();
  if (!digits) return null;
  return digits.length === 3 ? `#${[...digits].map((d) => d + d).join('')}` : `#${digits}`;
}

/** `hex` must be '#rrggbb' (see parseHexInput). */
export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const top = Math.max(r, g, b);
  const range = top - Math.min(r, g, b);
  let sector = 0;
  if (range > 0 && top === r) sector = ((g - b) / range + 6) % 6;
  else if (range > 0 && top === g) sector = (b - r) / range + 2;
  else if (range > 0) sector = (r - g) / range + 4;
  return { h: sector * 60, s: top === 0 ? 0 : (range / top) * 100, v: top * 100 };
}

/** Out-of-range saturation and value are clamped; the hue wraps (360 = 0). */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue) % 6;
    const c = val - val * sat * clamp(Math.min(k, 4 - k), 0, 1);
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/** One keyboard step on the saturation/brightness plane or the hue slider. */
export type HsvChannel = 'plane' | 'hue';

type KeyMove = number | 'min' | 'max';

/** Signed step of a key: arrows 1 (10 with `big`), Page keys 10, Home/End to the ends. */
function keyMove(key: string, up: string, down: string, big: boolean): KeyMove | null {
  const step = big ? 10 : 1;
  const moves: Readonly<Record<string, KeyMove>> = {
    [up]: step,
    [down]: -step,
    PageUp: 10,
    PageDown: -10,
    Home: 'min',
    End: 'max',
  };
  return Object.hasOwn(moves, key) ? moves[key] : null;
}

const applyMove = (current: number, move: KeyMove, top: number) =>
  move === 'min' ? 0 : move === 'max' ? top : clamp(current + move, 0, top);

const VERTICAL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);

/**
 * Where a key moves the colour. Plane: Left/Right and Home/End change the saturation, Up/Down and
 * the Page keys the brightness. Hue: Left/Down lower it, Right/Up raise it. Null for other keys.
 */
export function hsvAfterKey(hsv: Hsv, channel: HsvChannel, key: string, big: boolean): Hsv | null {
  if (channel === 'hue') {
    const move =
      keyMove(key, 'ArrowRight', 'ArrowLeft', big) ?? keyMove(key, 'ArrowUp', 'ArrowDown', big);
    return move === null ? null : { ...hsv, h: applyMove(hsv.h, move, 360) };
  }
  if (VERTICAL_KEYS.has(key)) {
    const move = keyMove(key, 'ArrowUp', 'ArrowDown', big);
    return move === null ? null : { ...hsv, v: applyMove(hsv.v, move, 100) };
  }
  const move = keyMove(key, 'ArrowRight', 'ArrowLeft', big);
  return move === null ? null : { ...hsv, s: applyMove(hsv.s, move, 100) };
}
