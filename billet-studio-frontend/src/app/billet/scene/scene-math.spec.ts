import { describe, expect, it } from 'vitest';

import { fitTransform, loadFraction, orbitLimits } from './scene-math';

describe('scene math', () => {
  it('fits like the original card: largest edge to fitSize, centred, then shifted by yOffset', () => {
    const fit = fitTransform({ center: [1, 2, -3], maxDim: 3.2 }, 1.6, -0.08);
    expect(fit.scale).toBe(0.5);
    expect(fit.position[0]).toBeCloseTo(-0.5);
    expect(fit.position[1]).toBeCloseTo(-1.08);
    expect(fit.position[2]).toBeCloseTo(1.5);

    expect(fitTransform({ center: [0, 0, 0], maxDim: 0 }, 1.6, 0).scale).toBe(1);
  });

  it('keeps the original zoom limits and widens them only for a camera placed beyond them', () => {
    expect(orbitLimits(2.8, 0.1)).toEqual({ minDistance: 1.2, maxDistance: 4 });

    const far = orbitLimits(6, 2);
    expect(far.maxDistance).toBeCloseTo(Math.hypot(6, 2));
    expect(far.minDistance / far.maxDistance).toBeCloseTo(1.2 / 4);
  });

  it('measures download progress against the catalog size, not a compressed Content-Length', () => {
    expect(loadFraction(2_000_000, 1_000_000, 4_000_000)).toBe(0.5);
    expect(loadFraction(250, 1000, 0)).toBe(0.25);
    expect(loadFraction(250, 0, 0)).toBeNull();
    expect(loadFraction(5000, 0, 4000)).toBe(1);
  });
});
