import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocument, type BilletDocument } from '../../billet/billet-document';
import {
  LocalBilletError,
  type LocalBilletErrorCode,
} from '../../core/services/local-billet-store';
import { createEditorAutosave, type EditorAutosave } from './editor-autosave';

describe('createEditorAutosave', () => {
  let model: WritableSignal<BilletDocument>;
  let written: string[];
  let refusal: LocalBilletErrorCode | null;
  let autosave: EditorAutosave;

  /** What the form does on a keystroke; the effect that schedules the write runs on tick. */
  function edit(title: string, thenWaitMs = 0): void {
    model.update((document) => ({ ...document, title }));
    TestBed.tick();
    vi.advanceTimersByTime(thenWaitMs);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    model = signal(createDocument({ lang: 'de' }));
    written = [];
    refusal = null;
    autosave = TestBed.runInInjectionContext(() =>
      createEditorAutosave({
        model,
        save: (document) => {
          if (refusal) throw new LocalBilletError(refusal);
          written.push(document.title);
        },
        enabled: signal(true),
      }),
    );
  });

  afterEach(() => vi.useRealTimers());

  it('writes after a pause in typing, and during non-stop typing every 10 s at the latest', () => {
    edit('A', 1000);
    edit('AB', 1199);
    expect(autosave.status()).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(written).toEqual(['AB']);
    expect(autosave.status()).toBe('saved');

    for (let second = 0; second < 12; second++) edit(`t${second}`, 1000);
    expect(written).toEqual(['AB', 't9']);
  });

  it('a refused write reads as an error and is retried with the next edit', () => {
    refusal = 'LOCAL_STORAGE_FULL';
    edit('A', 1200);
    expect(autosave.status()).toBe('error');
    expect(autosave.failure()).toBe('LOCAL_STORAGE_FULL');
    expect(autosave.flush()).toBe(false);

    refusal = null;
    edit('AB', 1200);
    expect(written).toEqual(['AB']);
    expect(autosave.status()).toBe('saved');
    expect(autosave.failure()).toBeNull();
  });

  it('holds edits while paused, and writes what is pending when the editor goes away', () => {
    autosave.paused.set(true);
    edit('A', 20_000);
    expect(written).toEqual([]);
    expect(autosave.status()).toBe('held');

    autosave.paused.set(false);
    TestBed.resetTestingModule();
    expect(written).toEqual(['A']);
  });
});
