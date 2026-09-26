import type { TemplateId } from '../../../billet/templates/templates';
import type { StoryMeta } from './hero-framing';

// The hero's clock as pure state transitions (docs/hero-story.md, "The clip" and "Idle phase").
// The stage advances it once per frame and scrubs the story clip to `time`; commands (chapters,
// replay, pause, a drag) are transitions too, so every jump is exact and testable.

export type HeroPhase = 'story' | 'idle';

/** The idle cycle's order; occasions whose gift or screen is not loaded yet are skipped. */
export const OCCASIONS: readonly TemplateId[] = [
  'valentinstag',
  'geburtstag',
  'hochzeit',
  'weihnachten',
  'muttertag',
];

/** Seconds between two occasions in the idle phase. */
const IDLE_CYCLE_SECONDS = 6;
/** A drag or a tap holds the idle cycle this long. */
const HOLD_SECONDS = 4;

// The occasion swap: the gift shrinks away, the screen crossfades, the next gift pops in.
const SHRINK_SECONDS = 0.25;
const CROSSFADE_START = 0.15;
const CROSSFADE_SECONDS = 0.5;
const POP_START = 0.45;
const POP_SECONDS = 0.35;
const SWAP_SECONDS = POP_START + POP_SECONDS;

export interface HeroClock {
  /** Story time in seconds, 0..duration; `duration` throughout the idle phase. */
  readonly time: number;
  readonly phase: HeroPhase;
  readonly playing: boolean;
  /** The occasion whose gift and screen are (or are becoming) visible. */
  readonly occasion: TemplateId;
  /** The occasion before the last swap; equals `occasion` once no swap was ever made. */
  readonly previous: TemplateId;
  /** Seconds since the last swap started, capped where the swap ends. */
  readonly sinceSwap: number;
  /** Seconds towards the next swap. */
  readonly cycle: number;
  /** Seconds the cycle still waits after an interaction. */
  readonly hold: number;
}

export interface AdvanceInput {
  /** The lock, message and billet screen textures are loaded. */
  readonly gatesOpen: boolean;
  /** Occasions whose gift and screen texture are ready to be shown. */
  readonly readyOccasions: ReadonlySet<TemplateId>;
}

/** Where an occasion swap is: which gift shows at which scale, and the screens' crossfade. */
export interface SwapPose {
  readonly showsPrevious: boolean;
  readonly giftScale: number;
  /** 0 = the previous occasion's screen, 1 = the current one's. */
  readonly screenMix: number;
}

/** The story at its first frame, paused. */
export function createClock(meta: StoryMeta): HeroClock {
  const occasion = meta.gift.templateId;
  return {
    time: 0,
    phase: 'story',
    playing: false,
    occasion,
    previous: occasion,
    sinceSwap: SWAP_SECONDS,
    cycle: 0,
    hold: 0,
  };
}

/** One frame of `seconds`. A paused clock stands still. */
export function advance(
  clock: HeroClock,
  seconds: number,
  meta: StoryMeta,
  input: AdvanceInput,
): HeroClock {
  if (!clock.playing || seconds <= 0) return clock;
  if (clock.phase === 'story') {
    const gate = meta.gates.screens;
    let time = clock.time + seconds;
    if (!input.gatesOpen && clock.time <= gate && time > gate) time = gate;
    if (time < meta.duration) return { ...clock, time };
    return { ...clock, time: meta.duration, phase: 'idle', cycle: 0, hold: 0 };
  }
  const sinceSwap = Math.min(SWAP_SECONDS, clock.sinceSwap + seconds);
  if (clock.hold > 0) return { ...clock, sinceSwap, hold: Math.max(0, clock.hold - seconds) };
  const cycle = clock.cycle + seconds;
  if (cycle < IDLE_CYCLE_SECONDS) return { ...clock, sinceSwap, cycle };
  const next = nextOccasion(clock.occasion, input.readyOccasions);
  if (!next) return { ...clock, sinceSwap, cycle: 0 };
  return { ...clock, previous: clock.occasion, occasion: next, sinceSwap: 0, cycle: 0 };
}

/** Jumps to the start of a beat, back in the story with its own gift. Playing or not stays. */
export function seekBeat(clock: HeroClock, meta: StoryMeta, index: number): HeroClock {
  const beat = meta.beats[Math.min(Math.max(0, index), meta.beats.length - 1)];
  return seekTime(clock, meta, beat.start);
}

/** Jumps to a story time (the dev page's `?t=`); the end of the clip is the idle phase. */
export function seekTime(clock: HeroClock, meta: StoryMeta, time: number): HeroClock {
  if (time >= meta.duration) return { ...settle(clock, meta), playing: clock.playing };
  const occasion = meta.gift.templateId;
  return {
    ...clock,
    time: Math.max(0, time),
    phase: 'story',
    occasion,
    previous: occasion,
    sinceSwap: SWAP_SECONDS,
    cycle: 0,
    hold: 0,
  };
}

/** The story from its first frame, playing. */
export function replay(clock: HeroClock, meta: StoryMeta): HeroClock {
  return { ...seekBeat(clock, meta, 0), playing: true };
}

/**
 * The end of the story, paused (reduced motion; a later visit plays on from here). An idle clock
 * keeps its occasion, a story settles on the story's own.
 */
export function settle(clock: HeroClock, meta: StoryMeta): HeroClock {
  const occasion = clock.phase === 'idle' ? clock.occasion : meta.gift.templateId;
  return {
    ...clock,
    time: meta.duration,
    phase: 'idle',
    playing: false,
    occasion,
    previous: occasion,
    sinceSwap: SWAP_SECONDS,
    cycle: 0,
    hold: 0,
  };
}

/** A drag or a tap: the idle cycle waits. */
export function interact(clock: HeroClock): HeroClock {
  return { ...clock, hold: HOLD_SECONDS };
}

/** The beat shown at `time`; the idle phase counts as the last one. */
export function beatIndex(time: number, meta: StoryMeta): number {
  let index = 0;
  meta.beats.forEach((beat, i) => {
    if (time >= beat.start) index = i;
  });
  return index;
}

export function swapPose(sinceSwap: number): SwapPose {
  const screenMix = smoothstep((sinceSwap - CROSSFADE_START) / CROSSFADE_SECONDS);
  if (sinceSwap < SHRINK_SECONDS) {
    const t = sinceSwap / SHRINK_SECONDS;
    return { showsPrevious: true, giftScale: 1 - t * t, screenMix };
  }
  if (sinceSwap < POP_START) return { showsPrevious: false, giftScale: 0, screenMix };
  return {
    showsPrevious: false,
    giftScale: easeOutBack(Math.min(1, (sinceSwap - POP_START) / POP_SECONDS)),
    screenMix,
  };
}

function nextOccasion(current: TemplateId, ready: ReadonlySet<TemplateId>): TemplateId | null {
  const start = OCCASIONS.indexOf(current);
  for (let step = 1; step < OCCASIONS.length; step++) {
    const candidate = OCCASIONS[(start + step) % OCCASIONS.length];
    if (ready.has(candidate)) return candidate;
  }
  return null;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** 0 → 1 with a small overshoot, the pop of a gift arriving. */
function easeOutBack(t: number): number {
  const overshoot = 1.4;
  const x = t - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}
