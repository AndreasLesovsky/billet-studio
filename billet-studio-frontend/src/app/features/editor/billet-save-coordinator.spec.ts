import { HttpErrorResponse } from '@angular/common/http';
import { Injector, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocument, type BilletDocument } from '../../billet/billet-document';
import type { BilletSaveResponse } from '../../core/models/models';
import { readBackup } from './billet-backup';
import { BilletSaveCoordinator } from './billet-save-coordinator';

interface SaveCall {
  readonly version: number;
  readonly title: string;
  readonly refusedBefore: boolean;
  answer(version: number): Promise<void>;
  fail(error: HttpErrorResponse): Promise<void>;
}

const USER_ID = 7;
const BILLET_ID = 42;

describe('createBilletSaveCoordinator', () => {
  let model: WritableSignal<BilletDocument>;
  let calls: SaveCall[];
  let signedIn: boolean;
  let coordinator: BilletSaveCoordinator;

  /** A keystroke in the form; the effect that schedules the save runs on tick. */
  function edit(title: string, thenWaitMs = 0): void {
    model.update((document) => ({ ...document, title }));
    TestBed.tick();
    vi.advanceTimersByTime(thenWaitMs);
  }

  const backedUpTitle = () => readBackup(USER_ID, BILLET_ID)?.document.title ?? null;

  function save(
    version: number,
    document: BilletDocument,
    refusedBefore: boolean,
  ): Promise<BilletSaveResponse> {
    return new Promise((resolve, reject) => {
      const settled = async () => {
        await vi.advanceTimersByTimeAsync(0);
      };
      calls.push({
        version,
        title: document.title,
        refusedBefore,
        answer: (next) => {
          resolve({
            version: next,
            updatedAt: '2026-05-10T08:00:00Z',
            hasUnpublishedChanges: false,
          });
          return settled();
        },
        fail: (error) => {
          reject(error);
          return settled();
        },
      });
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    model = signal(createDocument({ lang: 'de' }));
    calls = [];
    signedIn = true;
    coordinator = new BilletSaveCoordinator({
      billetId: BILLET_ID,
      userId: USER_ID,
      version: 3,
      model,
      save,
      canSave: () => signedIn,
      injector: TestBed.inject(Injector),
    });
  });

  afterEach(() => vi.useRealTimers());

  it('saves 1.2 s after the last edit, and during non-stop editing every 10 s at the latest', async () => {
    edit('A', 1000);
    edit('AB', 1199);
    expect(calls).toHaveLength(0);
    expect(coordinator.state()).toBe('dirty');
    vi.advanceTimersByTime(1);
    expect(calls.map((c) => c.title)).toEqual(['AB']);
    expect(coordinator.state()).toBe('saving');
    await calls[0].answer(4);
    expect(coordinator.state()).toBe('idle');

    for (let second = 0; second < 12; second++) edit(`t${second}`, 1000);
    expect(calls.map((c) => c.title)).toEqual(['AB', 't9']);
  });

  it('sends one request at a time, each with the version the previous one returned', async () => {
    edit('A', 1200);
    edit('AB', 1200);
    expect(coordinator.flush()).toBe(true); // backed up while the first save is out
    expect(calls).toHaveLength(1);

    await calls[0].answer(4);
    expect(calls.map((c) => [c.version, c.title])).toEqual([
      [3, 'A'],
      [4, 'AB'],
    ]);
    await calls[1].answer(5);
    expect(coordinator.version()).toBe(5);
    expect(coordinator.state()).toBe('idle');
  });

  it('409 BILLET_MODIFIED_ELSEWHERE → conflict; nothing is sent until "keep mine" saves over the latest version', async () => {
    edit('A', 1200);
    await calls[0].fail(
      new HttpErrorResponse({ status: 409, error: { errorCode: 'BILLET_MODIFIED_ELSEWHERE' } }),
    );
    expect(coordinator.state()).toBe('conflict');

    edit('AB', 20_000);
    expect(calls).toHaveLength(1);
    expect(backedUpTitle()).toBe('AB');

    coordinator.keepMine(9);
    expect(calls.map((c) => [c.version, c.title])).toEqual([
      [3, 'A'],
      [9, 'AB'],
    ]);
    await calls[1].answer(10);
    expect(coordinator.state()).toBe('idle');
    expect(backedUpTitle()).toBeNull();
  });

  it('a refused save goes again with the next edit, marked so its refusal is not toasted twice', async () => {
    const refused = new HttpErrorResponse({
      status: 500,
      error: { errorCode: 'INTERNAL_SERVER_ERROR' },
    });
    edit('A', 1200);
    await calls[0].fail(refused);
    expect([coordinator.state(), coordinator.failure()]).toEqual(['error', 'rejected']);

    edit('AB', 1200);
    await calls[1].fail(refused);
    edit('ABC', 1200);
    await calls[2].answer(4);
    edit('ABCD', 1200);

    expect(calls.map((c) => [c.title, c.refusedBefore])).toEqual([
      ['A', false],
      ['AB', true],
      ['ABC', true],
      ['ABCD', false],
    ]);
  });

  it('keeps the backup until the server has the document: offline it retries, signed out it waits', async () => {
    edit('A', 1200);
    expect(backedUpTitle()).toBe('A');
    await calls[0].fail(new HttpErrorResponse({ status: 0 }));
    expect([coordinator.state(), coordinator.failure()]).toEqual(['error', 'offline']);

    edit('AB', 1200);
    expect(calls).toHaveLength(1);
    expect(backedUpTitle()).toBe('AB');
    vi.advanceTimersByTime(2000);
    expect(calls.map((c) => [c.version, c.title])).toEqual([
      [3, 'A'],
      [3, 'AB'],
    ]);
    await calls[1].answer(4);
    expect(coordinator.state()).toBe('idle');
    expect(backedUpTitle()).toBeNull();

    signedIn = false;
    edit('ABC', 1200);
    coordinator.dispose();
    expect(calls).toHaveLength(2);
    expect(backedUpTitle()).toBe('ABC');
  });

  it('settled() (before a publish) sends the pending edit and waits for its follow-up save too', async () => {
    edit('A', 1200);
    edit('AB');
    let settledAs: string | undefined;
    void coordinator.settled().then((state) => (settledAs = state));

    await calls[0].answer(4);
    expect(calls.map((c) => [c.version, c.title])).toEqual([
      [3, 'A'],
      [4, 'AB'],
    ]);
    expect(settledAs).toBeUndefined();

    await calls[1].answer(5);
    expect(settledAs).toBe('idle');
    expect(coordinator.version()).toBe(5);
  });
});
