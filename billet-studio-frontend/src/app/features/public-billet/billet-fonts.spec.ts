import { afterEach, describe, expect, it, vi } from 'vitest';

import { whenFontsReady } from './billet-fonts';

describe('whenFontsReady', () => {
  afterEach(() => vi.useRealTimers());

  it('a font that never arrives holds the billet back for 1.5 s at most', async () => {
    vi.useFakeTimers();
    const fonts = { load: vi.fn(() => new Promise<FontFace[]>(() => undefined)) };
    let ready = false;

    void whenFontsReady(fonts, [{ font: 'italic 300 1em Jost', text: 'Mama' }]).then(
      () => (ready = true),
    );
    await vi.advanceTimersByTimeAsync(1499);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(ready).toBe(true);
    expect(fonts.load).toHaveBeenCalledWith('italic 300 1em Jost', 'Mama');
  });
});
