import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { runPending } from './pending';

describe('runPending', () => {
  it('holds pending while the action runs and releases it when the action fails', async () => {
    const pending = signal(false);
    let fail!: (error: Error) => void;

    const run = runPending(pending, () => new Promise<void>((_, reject) => (fail = reject)));
    expect(pending()).toBe(true);

    fail(new Error('BILLET_NOT_FOUND'));
    await expect(run).rejects.toThrow('BILLET_NOT_FOUND');
    expect(pending()).toBe(false);
  });
});
