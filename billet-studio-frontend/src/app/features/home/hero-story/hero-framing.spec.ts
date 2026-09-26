import { describe, expect, it } from 'vitest';

import { fitVerticalFov, parseDockExtras, parseStoryMeta, sceneOffset } from './hero-framing';

const CONTRACT = {
  version: 1,
  fps: 30,
  duration: 10.0,
  clip: 'Story',
  aspect: 1,
  fovDeg: 30.0,
  beats: [
    { id: 'write', start: 0.0, end: 3.6 },
    { id: 'gift', start: 3.6, end: 6.2 },
    { id: 'share', start: 6.2, end: 10.0 },
  ],
  gates: { screens: 6.4 },
  marks: { land: 9.2 },
  gift: { templateId: 'valentinstag' },
};

function withChange(change: (meta: Record<string, unknown>) => void): string {
  const meta: Record<string, unknown> = structuredClone(CONTRACT);
  change(meta);
  return JSON.stringify(meta);
}

describe('hero framing', () => {
  it('keeps the authored FOV on wider stages and widens it until the authored width fits', () => {
    expect(fitVerticalFov(30, 1, 1)).toBe(30);
    expect(fitVerticalFov(30, 1, 1.6)).toBe(30);

    const narrow = fitVerticalFov(30, 1, 0.5);
    // The horizontal half-angle at aspect 0.5 equals the authored one at aspect 1.
    const horizontal = Math.tan(((narrow / 2) * Math.PI) / 180) * 0.5;
    expect(horizontal).toBeCloseTo(Math.tan((15 * Math.PI) / 180));
  });

  it('reads the contract example of docs/hero-story.md', () => {
    const meta = parseStoryMeta(JSON.stringify(CONTRACT));
    expect(meta.duration).toBe(10);
    expect(meta.beats.map((beat) => beat.id)).toEqual(['write', 'gift', 'share']);
    expect(meta.gates.screens).toBe(6.4);
    expect(meta.gift.templateId).toBe('valentinstag');
  });

  it('rejects broken story data instead of playing it', () => {
    expect(() => parseStoryMeta(undefined)).toThrow();
    expect(() => parseStoryMeta('{not json')).toThrow();
    expect(() => parseStoryMeta(withChange((m) => (m['version'] = 2)))).toThrow(/version/);
    expect(() => parseStoryMeta(withChange((m) => (m['duration'] = 0)))).toThrow(/duration/);
    expect(() => parseStoryMeta(withChange((m) => (m['fovDeg'] = 190)))).toThrow(/fovDeg/);
    expect(() => parseStoryMeta(withChange((m) => (m['gift'] = { templateId: 'ostern' })))).toThrow(
      /templateId/,
    );
    expect(() => parseStoryMeta(withChange((m) => (m['gates'] = { screens: 12 })))).toThrow(
      /gates/,
    );
    // Beats: out of order, with a gap, or ending before the clip.
    expect(() =>
      parseStoryMeta(withChange((m) => (m['beats'] = [...CONTRACT.beats].reverse()))),
    ).toThrow(/beats/);
    expect(() =>
      parseStoryMeta(
        withChange(
          (m) =>
            (m['beats'] = [
              CONTRACT.beats[0],
              { ...CONTRACT.beats[1], start: 4 },
              CONTRACT.beats[2],
            ]),
        ),
      ),
    ).toThrow(/beats\[1\]/);
    expect(() =>
      parseStoryMeta(
        withChange(
          (m) =>
            (m['beats'] = [CONTRACT.beats[0], CONTRACT.beats[1], { ...CONTRACT.beats[2], end: 9 }]),
        ),
      ),
    ).toThrow(/last beat/);
  });

  it('reads the dock rects in each form Blender may export them', () => {
    const dock = parseDockExtras({
      sceneRectDe: '[0, 0.45, 1, 0.45]',
      screenWidthM: 0.07,
      screenHeightM: 0.15,
    });
    expect(dock.sceneRectDe).toEqual({ x: 0, y: 0.45, w: 1, h: 0.45 });
    expect(parseDockExtras({ ...dock, sceneRectDe: '{"x":0,"y":0.4,"w":1,"h":0.5}' })).toEqual({
      ...dock,
      sceneRectDe: { x: 0, y: 0.4, w: 1, h: 0.5 },
    });
    expect(() => parseDockExtras({ ...dock, sceneRectDe: { x: 0, y: 0, w: 0, h: 1 } })).toThrow();
    expect(() => parseDockExtras({ ...dock, screenWidthM: undefined })).toThrow();
  });

  it('moves a gift by the scene areas’ centres in metres (y up) and scales it by their heights', () => {
    const reference = { x: 0, y: 0.454439, w: 1, h: 0.450237 };
    expect(sceneOffset(reference, reference, 0.07, 0.15)).toEqual({ x: 0, y: 0, scale: 1 });

    const lower = sceneOffset({ x: 0, y: 0.482487, w: 1, h: 0.450237 }, reference, 0.07, 0.15);
    expect(lower.x).toBe(0);
    expect(lower.y).toBeCloseTo(-0.028048 * 0.15);
    expect(lower.scale).toBe(1);

    const smaller = sceneOffset({ x: 0.25, y: 0.5, w: 0.5, h: 0.225 }, reference, 0.07, 0.15);
    expect(smaller.x).toBeCloseTo(0);
    expect(smaller.scale).toBeCloseTo(0.5);
  });
});
