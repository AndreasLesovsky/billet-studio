import { describe, expect, it } from 'vitest';

import { particleBudget, ParticleSim, type ParticleSettings } from './particle-sim';

/** mulberry32: the same seed gives both simulations the same particles. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SETTINGS: ParticleSettings = {
  shape: 'petal',
  colors: ['#e8927a', '#f0b9aa', '#d97060'],
  density: 50,
  speed: 1,
  size: 1,
};
const BOUNDS = { width: 390, height: 240, spread: 200 };
const FRAME_MS = 1000 / 60;

function run(frameMs: number, seconds: number, settings = SETTINGS): ParticleSim {
  const sim = new ParticleSim(settings, BOUNDS, seeded(7));
  const frames = Math.round((seconds * 1000) / frameMs);
  for (let i = 0; i < frames; i++) sim.update(frameMs);
  return sim;
}

describe('particle-sim', () => {
  it('density maps to the first wave, the in-air limit and the total cap (50 = the live card)', () => {
    expect(particleBudget(50)).toEqual({ count: 28, inAirMax: 12, totalCap: 84 });
    expect(particleBudget(100)).toEqual({ count: 56, inAirMax: 24, totalCap: 168 });
    expect(particleBudget(0)).toEqual({ count: 0, inAirMax: 0, totalCap: 0 });
  });

  it('120 Hz lands every particle where 60 Hz does over the same wall time', () => {
    for (const settings of [SETTINGS, { ...SETTINGS, shape: 'confetti' as const, speed: 2 }]) {
      const at60 = run(FRAME_MS, 20, settings);
      const at120 = run(FRAME_MS / 2, 20, settings);

      // Enough time for landings and respawns, so both paths are compared.
      expect(at60.particles.some((p) => p.settled)).toBe(true);
      expect(at60.particles.length).toBeGreaterThan(28);
      expect(at120.particles.length).toBe(at60.particles.length);
      at60.particles.forEach((p, i) => {
        const q = at120.particles[i];
        expect(q.settled).toBe(p.settled);
        expect(q.x).toBeCloseTo(p.x, 6);
        expect(q.y).toBeCloseTo(p.y, 6);
        expect(q.rotation).toBeCloseTo(p.rotation, 6);
        expect(q.opacity).toBe(p.opacity);
      });
    }
  });

  it('a particle settles on the floor with a snapped rotation and is not updated again', () => {
    const sim = new ParticleSim(SETTINGS, BOUNDS, seeded(3));
    let landed = sim.particles.find((p) => p.settled);
    while (!landed) {
      sim.update(FRAME_MS);
      landed = sim.particles.find((p) => p.settled);
    }
    const snapshot = { ...landed };

    expect(landed.y).toBeCloseTo(BOUNDS.height - landed.height, 9);
    expect(Math.abs(landed.rotation % 15)).toBe(0);
    for (let i = 0; i < 600; i++) {
      expect(sim.update(FRAME_MS)).not.toContain(landed);
    }
    expect({ ...landed }).toEqual(snapshot);
  });
});
