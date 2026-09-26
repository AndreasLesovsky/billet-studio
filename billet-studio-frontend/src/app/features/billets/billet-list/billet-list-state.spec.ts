import { describe, expect, it } from 'vitest';

import { createDocument, type BilletDocument } from '../../../billet/billet-document';
import type { BilletSummaryDto } from '../../../core/models/models';
import type { LocalBilletEntry } from '../../../core/services/local-billet-store';
import { importBatch, importOffer } from './billet-list-state';

describe('billet list state', () => {
  const entry = (localId: string): LocalBilletEntry => ({
    localId,
    title: localId,
    theme: 'rose',
    modelSlug: null,
    templateId: null,
    updatedAt: '2026-05-10T08:00:00Z',
  });
  const rows = (count: number) =>
    Array.from({ length: count }, (_, id) => ({ id }) as BilletSummaryDto);

  it('an import sends the readable device billets oldest first, and at most 20 per request', () => {
    // Newest first, as the device lists them; "b" cannot be read.
    const entries = ['d', 'c', 'b', 'a'].map(entry);
    const load = (localId: string): BilletDocument | null =>
      localId === 'b' ? null : { ...createDocument({ lang: 'de' }), title: localId };

    const batch = importBatch(entries, load);
    expect(batch.localIds).toEqual(['a', 'c', 'd']);
    expect(batch.documents.map((d) => d.title)).toEqual(['a', 'c', 'd']);

    const many = Array.from({ length: 25 }, (_, i) => entry(`e${24 - i}`));
    expect(importBatch(many, load).localIds).toEqual(Array.from({ length: 20 }, (_, i) => `e${i}`));
  });

  it('"move all to my account" goes only when the account is known and has room for all of them', () => {
    expect(importOffer(0, rows(3))).toBeNull();
    expect(importOffer(3, 'loading')).toEqual({ count: 3, free: null, fits: false });
    expect(importOffer(3, 'failed')?.fits).toBe(false);

    expect(importOffer(3, rows(47))).toEqual({ count: 3, free: 3, fits: true });
    expect(importOffer(4, rows(47))).toEqual({ count: 4, free: 3, fits: false });
    expect(importOffer(1, rows(52))).toEqual({ count: 1, free: 0, fits: false });
  });
});
