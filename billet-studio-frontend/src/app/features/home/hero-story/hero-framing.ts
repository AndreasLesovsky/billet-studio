import { TEMPLATE_IDS, type TemplateId } from '../../../billet/templates/templates';
import type { HeroRect } from './hero-assets.generated';
import { BEAT_IDS, type BeatId } from './hero-beats';

// Pure numbers of the hero's 3D story (docs/hero-story.md), used by the stage (lazy hero chunk);
// the home chunk imports only types from here.

export interface StoryBeat {
  readonly id: BeatId;
  readonly start: number;
  readonly end: number;
}

/** The glTF scene's `extras.heroStory`, validated. Times in seconds. */
export interface StoryMeta {
  readonly fps: number;
  readonly duration: number;
  readonly clip: string;
  /** Width / height of the authored frame. */
  readonly aspect: number;
  /** Vertical field of view of the authored frame, degrees. */
  readonly fovDeg: number;
  readonly beats: readonly StoryBeat[];
  readonly gates: { readonly screens: number };
  readonly marks: { readonly land: number };
  readonly gift: { readonly templateId: TemplateId };
}

/**
 * Custom properties of `Phone_ScreenDock` the runtime needs, validated. `sceneRectEn` and
 * `dockScale` may be there too but are not read: the EN and other templates' rects come from
 * hero-captures.json, the scale from the node itself.
 */
export interface DockExtras {
  readonly sceneRectDe: HeroRect;
  readonly screenWidthM: number;
  readonly screenHeightM: number;
}

/** Where a gift stands relative to the dock: an offset in the screen plane (metres) and a scale. */
export interface SceneOffset {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** Beats must meet within this many seconds (float noise from the exporter). */
const TIME_EPSILON = 1e-3;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The vertical field of view that shows the whole authored frame at `aspect`, like
 * `object-fit: contain`: a wider stage keeps the authored FOV (more room left and right), a narrower
 * one widens it until the authored width fits.
 */
export function fitVerticalFov(fovDeg: number, authoredAspect: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= authoredAspect) return fovDeg;
  const half = Math.atan((Math.tan(toRadians(fovDeg) / 2) * authoredAspect) / aspect);
  return (half * 2 * 180) / Math.PI;
}

/** Parses `extras.heroStory` (a JSON string) and throws on anything the runtime cannot play. */
export function parseStoryMeta(raw: unknown): StoryMeta {
  if (typeof raw !== 'string') throw new Error('heroStory: missing (expected a JSON string)');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('heroStory: not valid JSON');
  }
  const meta = record(data, 'heroStory');
  if (meta['version'] !== 1) throw new Error('heroStory: unsupported version');
  const duration = positive(meta['duration'], 'duration');
  const clip = meta['clip'];
  if (typeof clip !== 'string' || !clip) throw new Error('heroStory: clip must be a name');
  const fovDeg = positive(meta['fovDeg'], 'fovDeg');
  if (fovDeg >= 180) throw new Error('heroStory: fovDeg must be below 180');
  const gates = record(meta['gates'], 'gates');
  const marks = record(meta['marks'], 'marks');
  const gift = record(meta['gift'], 'gift');
  const templateId = gift['templateId'];
  if (!TEMPLATE_IDS.includes(templateId as TemplateId)) {
    throw new Error('heroStory: gift.templateId is not a template');
  }
  return {
    fps: positive(meta['fps'], 'fps'),
    duration,
    clip,
    aspect: positive(meta['aspect'], 'aspect'),
    fovDeg,
    beats: parseBeats(meta['beats'], duration),
    gates: { screens: within(gates['screens'], duration, 'gates.screens') },
    marks: { land: within(marks['land'], duration, 'marks.land') },
    gift: { templateId: templateId as TemplateId },
  };
}

/** Three contiguous beats in BEAT_IDS order, from 0 to the end of the clip. */
function parseBeats(raw: unknown, duration: number): StoryBeat[] {
  if (!Array.isArray(raw) || raw.length !== BEAT_IDS.length) {
    throw new Error(`heroStory: beats must list ${BEAT_IDS.join(', ')}`);
  }
  const beats: StoryBeat[] = [];
  let expectedStart = 0;
  for (const [index, id] of BEAT_IDS.entries()) {
    const beat = record(raw[index], `beats[${index}]`);
    if (beat['id'] !== id) throw new Error(`heroStory: beats[${index}] must be '${id}'`);
    const start = within(beat['start'], duration, `beats[${index}].start`);
    const end = within(beat['end'], duration, `beats[${index}].end`);
    if (Math.abs(start - expectedStart) > TIME_EPSILON || end <= start) {
      throw new Error(`heroStory: beats[${index}] does not follow on from the previous beat`);
    }
    beats.push({ id, start, end });
    expectedStart = end;
  }
  if (Math.abs(expectedStart - duration) > TIME_EPSILON) {
    throw new Error('heroStory: the last beat must end with the clip');
  }
  return beats;
}

/**
 * Reads the dock's custom properties. A rect may arrive as {x, y, w, h}, as [x, y, w, h] or as a
 * JSON string of either (how Blender exports a custom property depends on its type).
 */
export function parseDockExtras(userData: unknown): DockExtras {
  const data = record(userData, 'Phone_ScreenDock extras');
  return {
    sceneRectDe: parseRect(data['sceneRectDe'], 'sceneRectDe'),
    screenWidthM: positive(data['screenWidthM'], 'screenWidthM'),
    screenHeightM: positive(data['screenHeightM'], 'screenHeightM'),
  };
}

function parseRect(raw: unknown, name: string): HeroRect {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(`${name}: not valid JSON`);
    }
  }
  const [x, y, w, h] = Array.isArray(value)
    ? value
    : ['x', 'y', 'w', 'h'].map((key) => record(value, name)[key]);
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) {
    throw new Error(`${name}: expected a rect {x, y, w, h}`);
  }
  return { x, y, w, h };
}

/**
 * How far a gift moves in the screen plane, and how much it grows, when the screen shows `rect`
 * instead of the `reference` the dock was placed on: the centres' difference in metres (x right,
 * y up; a rect's y runs from the top) and the ratio of the scene areas' heights, as the billet's
 * camera frames the gift by the area's height.
 */
export function sceneOffset(
  rect: HeroRect,
  reference: HeroRect,
  screenWidthM: number,
  screenHeightM: number,
): SceneOffset {
  return {
    x: (rect.x + rect.w / 2 - (reference.x + reference.w / 2)) * screenWidthM,
    y: (reference.y + reference.h / 2 - (rect.y + rect.h / 2)) * screenHeightM,
    scale: rect.h / reference.h,
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function within(value: unknown, duration: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > duration) {
    throw new Error(`heroStory: ${name} must lie within the clip`);
  }
  return value;
}
