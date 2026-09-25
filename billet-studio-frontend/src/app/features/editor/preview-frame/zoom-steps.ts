/** The preview's zoom levels in percent, smallest first. */
const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200] as const;

export type ZoomStep = (typeof ZOOM_STEPS)[number];

/** 'fit' follows the stage's size; a step stays fixed. */
export type ZoomSetting = 'fit' | ZoomStep;

export interface Size {
  readonly width: number;
  readonly height: number;
}

const MIN_ZOOM = ZOOM_STEPS[0] / 100;
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] / 100;

const isZoomStep = (value: number): value is ZoomStep =>
  (ZOOM_STEPS as readonly number[]).includes(value);

/** A zoom factor within the steps' range. */
function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The percentage the zoom control shows; the steps are taken from it, not from the raw factor. */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/** The first step above the shown percentage, or null at the top. */
export function nextZoomStep(zoom: number): ZoomStep | null {
  const shown = zoomPercent(zoom);
  return ZOOM_STEPS.find((step) => step > shown) ?? null;
}

/** The first step below the shown percentage, or null at the bottom. */
export function previousZoomStep(zoom: number): ZoomStep | null {
  const shown = zoomPercent(zoom);
  return ZOOM_STEPS.filter((step) => step < shown).at(-1) ?? null;
}

/**
 * "Fit": the largest zoom, at most 100 %, at which the frame fits the stage - on both sides, or on
 * its width only for a frame whose height follows the stage (desktop). Rounded down, so the scaled
 * frame never overflows by a rounding error; clamped to the steps, so a tiny stage scrolls instead.
 */
export function fitZoom(stage: Size, frame: Size, fitHeight: boolean): number {
  const byWidth = stage.width / frame.width;
  const byHeight = fitHeight ? stage.height / frame.height : Infinity;
  return clampZoom(Math.floor(Math.min(1, byWidth, byHeight) * 1000) / 1000);
}

export function zoomFactor(setting: ZoomSetting, fit: number): number {
  return setting === 'fit' ? fit : setting / 100;
}

/** A stored setting; anything else (absent, from an older build, edited by hand) is 'fit'. */
export function parseZoomSetting(value: string | null): ZoomSetting {
  const step = Number(value);
  return value !== null && isZoomStep(step) ? step : 'fit';
}
