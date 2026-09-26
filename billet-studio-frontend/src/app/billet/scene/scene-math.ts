import type { BilletDocument } from '../billet-document';

// Pure numbers behind the 3D scene. No three.js import: this module is shared by the component
// (initial chunk of its route) and the stage (lazy three chunk).

const STAGE_KEYS = [
  'fitSize',
  'yOffset',
  'exposure',
  'cameraDistance',
  'cameraHeight',
  'autoRotate',
  'autoRotateSpeed',
] as const;

/** The scene fields the stage renders; the editor changes them live via sliders. */
export type StageSettings = Pick<BilletDocument['scene'], (typeof STAGE_KEYS)[number]>;

export function sameStageSettings(a: StageSettings, b: StageSettings): boolean {
  return STAGE_KEYS.every((key) => a[key] === b[key]);
}

/**
 * What a mouse wheel over the scene does. 'modifier': a plain wheel scrolls the page past it, only
 * Ctrl/⌘ + wheel zooms (a trackpad pinch arrives as Ctrl + wheel). 'off': the wheel never zooms.
 * Touch pinch zooms in both.
 */
export type WheelZoom = 'modifier' | 'off';

/** Bounding box of a model at identity transform. */
export interface FitBox {
  readonly center: readonly [number, number, number];
  readonly maxDim: number;
}

export interface FitTransform {
  readonly scale: number;
  readonly position: [number, number, number];
}

/**
 * The original card's auto-fit: the largest edge becomes `fitSize`, the box centre moves to the
 * origin, then the model shifts by `yOffset`. An empty or degenerate box keeps its size.
 */
export function fitTransform(box: FitBox, fitSize: number, yOffset: number): FitTransform {
  const scale = box.maxDim > 0 && Number.isFinite(box.maxDim) ? fitSize / box.maxDim : 1;
  const [x, y, z] = box.center;
  return { scale, position: [-x * scale, -y * scale + yOffset, -z * scale] };
}

const MIN_DISTANCE = 1.2;
const MAX_DISTANCE = 4;

/**
 * Zoom limits of the original card (1.2..4). A configured camera further out than 4 scales both,
 * so the start pose is never clamped closer than the document asks for.
 */
export function orbitLimits(
  cameraDistance: number,
  cameraHeight: number,
): { minDistance: number; maxDistance: number } {
  const factor = Math.max(1, Math.hypot(cameraDistance, cameraHeight) / MAX_DISTANCE);
  return { minDistance: MIN_DISTANCE * factor, maxDistance: MAX_DISTANCE * factor };
}

/** Camera position at `azimuth` (radians around y, 0 = front) for the document's distance/height. */
export function cameraPosition(
  azimuth: number,
  cameraDistance: number,
  cameraHeight: number,
): [number, number, number] {
  return [cameraDistance * Math.sin(azimuth), cameraHeight, cameraDistance * Math.cos(azimuth)];
}

const MAX_FRAME_SECONDS = 0.1;

/**
 * Seconds since the previous frame. The first frame after a (re)start is 0 and a long gap is
 * capped, so a scene resuming from off-screen does not jump.
 */
export function frameSeconds(previous: number | null, now: number): number {
  if (previous === null) return 0;
  return Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - previous) / 1000));
}

/**
 * Download progress 0..1, or null while the size is unknown. The catalog's file size wins over
 * the response's Content-Length: with a compressed transfer the header counts encoded bytes while
 * `loaded` counts decoded ones.
 */
export function loadFraction(loaded: number, total: number, expectedBytes: number): number | null {
  const size = expectedBytes > 0 ? expectedBytes : total;
  return size > 0 ? Math.min(1, Math.max(0, loaded / size)) : null;
}
