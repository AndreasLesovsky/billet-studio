import { describe, expect, it } from 'vitest';

import type { TemplateId } from '../../../billet/templates/templates';
import type { StoryMeta } from './hero-framing';
import {
  advance,
  beatIndex,
  createClock,
  interact,
  replay,
  seekBeat,
  settle,
  swapPose,
  type AdvanceInput,
  type HeroClock,
} from './hero-timeline';

const META: StoryMeta = {
  fps: 30,
  duration: 10,
  clip: 'Story',
  aspect: 1,
  fovDeg: 30,
  beats: [
    { id: 'write', start: 0, end: 3.6 },
    { id: 'gift', start: 3.6, end: 6.2 },
    { id: 'share', start: 6.2, end: 10 },
  ],
  gates: { screens: 6.4 },
  marks: { land: 9.2 },
  gift: { templateId: 'valentinstag' },
};

const ALL_READY: AdvanceInput = {
  gatesOpen: true,
  readyOccasions: new Set<TemplateId>([
    'valentinstag',
    'geburtstag',
    'hochzeit',
    'weihnachten',
    'muttertag',
  ]),
};

function playing(overrides: Partial<HeroClock> = {}): HeroClock {
  return { ...createClock(META), playing: true, ...overrides };
}

/** Advances in 1/60 s frames. */
function run(clock: HeroClock, seconds: number, input: AdvanceInput = ALL_READY): HeroClock {
  let next = clock;
  for (let i = 0; i < Math.round(seconds * 60); i++) next = advance(next, 1 / 60, META, input);
  return next;
}

describe('hero timeline', () => {
  it('stands still while paused', () => {
    const clock = createClock(META);
    expect(advance(clock, 0.5, META, ALL_READY)).toBe(clock);
  });

  it('waits at the screens gate until the screen textures are loaded, then plays on', () => {
    const waiting = run(playing({ time: 6 }), 1, { ...ALL_READY, gatesOpen: false });
    expect(waiting.time).toBe(6.4);
    expect(waiting.phase).toBe('story');

    expect(run(waiting, 0.5).time).toBeCloseTo(6.9);
    // A chapter jump past the gate is not pulled back to it.
    expect(run(playing({ time: 7 }), 0.5, { ...ALL_READY, gatesOpen: false }).time).toBeCloseTo(
      7.5,
    );
  });

  it('enters the idle phase at the end of the clip and stays at its last frame', () => {
    const idle = run(playing({ time: 9.9 }), 0.5);
    expect(idle.phase).toBe('idle');
    expect(idle.time).toBe(10);
    expect(idle.occasion).toBe('valentinstag');
  });

  it('cycles the occasions every 6 s in order, skipping those not loaded yet', () => {
    const idle = settle(playing(), META);
    const started = { ...idle, playing: true };
    expect(run(started, 5.9).occasion).toBe('valentinstag');

    const first = run(started, 6.1);
    expect(first.occasion).toBe('geburtstag');
    expect(first.previous).toBe('valentinstag');

    const partial: AdvanceInput = {
      gatesOpen: true,
      readyOccasions: new Set<TemplateId>(['valentinstag', 'weihnachten']),
    };
    expect(run(started, 6.1, partial).occasion).toBe('weihnachten');
    expect(run(run(started, 6.1, partial), 6.1, partial).occasion).toBe('valentinstag');

    const nothingElse: AdvanceInput = {
      gatesOpen: true,
      readyOccasions: new Set<TemplateId>(['valentinstag']),
    };
    expect(run(started, 13, nothingElse).occasion).toBe('valentinstag');
  });

  it('holds the cycle for 4 s after an interaction', () => {
    const started = { ...settle(playing(), META), playing: true };
    const held = run(interact(run(started, 5)), 4.5);
    expect(held.occasion).toBe('valentinstag');
    expect(run(held, 1.6).occasion).toBe('geburtstag');
  });

  it('seeks a beat back into the story with its own gift, keeping play or pause', () => {
    const idle = run({ ...settle(playing(), META), playing: true }, 6.1);
    expect(idle.occasion).toBe('geburtstag');

    const seeked = seekBeat(idle, META, 1);
    expect(seeked).toMatchObject({ time: 3.6, phase: 'story', occasion: 'valentinstag' });
    expect(seeked.playing).toBe(true);
    expect(seekBeat(createClock(META), META, 2).playing).toBe(false);
    expect(seekBeat(idle, META, 9).time).toBe(6.2);
  });

  it('replays from the first frame and settles at the last one', () => {
    const idle = run({ ...settle(playing(), META), playing: true }, 6.1);
    expect(replay(idle, META)).toMatchObject({ time: 0, phase: 'story', playing: true });
    expect(replay(idle, META).occasion).toBe('valentinstag');

    expect(settle(playing({ time: 4 }), META)).toMatchObject({
      time: 10,
      phase: 'idle',
      playing: false,
      occasion: 'valentinstag',
    });
    expect(settle(idle, META).occasion).toBe('geburtstag');
  });

  it('names the beat shown at a time, the idle phase as the last one', () => {
    expect(beatIndex(0, META)).toBe(0);
    expect(beatIndex(3.59, META)).toBe(0);
    expect(beatIndex(3.6, META)).toBe(1);
    expect(beatIndex(10, META)).toBe(2);
  });

  it('shrinks the old gift, crossfades the screen and pops the new gift in', () => {
    expect(swapPose(0)).toEqual({ showsPrevious: true, giftScale: 1, screenMix: 0 });
    expect(swapPose(0.3)).toMatchObject({ showsPrevious: false, giftScale: 0 });
    const done = swapPose(0.8);
    expect(done.showsPrevious).toBe(false);
    expect(done.giftScale).toBeCloseTo(1);
    expect(done.screenMix).toBe(1);
  });
});
