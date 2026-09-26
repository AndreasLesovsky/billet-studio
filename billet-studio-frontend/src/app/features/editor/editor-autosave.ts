import {
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';

import type { BilletDocument } from '../../billet/billet-document';
import {
  LocalBilletError,
  type LocalBilletErrorCode,
} from '../../core/services/local-billet-store';
import { createSaveTimer, flushOnPageLeave } from './save-timer';

/** held: an edit waits while autosave is paused. */
export type SaveStatus = 'saved' | 'pending' | 'held' | 'error';

export interface EditorAutosave {
  readonly status: Signal<SaveStatus>;
  /** Why the last write failed; null after a successful one. */
  readonly failure: Signal<LocalBilletErrorCode | null>;
  /**
   * Writes a pending edit now (`force`: even an unchanged document). True when nothing is left
   * unsaved.
   */
  flush(force?: boolean): boolean;
  /** The document as it is stored right now (loaded, or taken over from another tab). */
  markSaved(document: BilletDocument): void;
  /** While set, nothing is written: the editor asks how to resolve another tab's change. */
  readonly paused: WritableSignal<boolean>;
}

interface AutosaveOptions {
  readonly model: Signal<BilletDocument>;
  readonly save: (document: BilletDocument) => void;
  /** False while there is no document to save (unknown localId). */
  readonly enabled: Signal<boolean>;
}

/**
 * Saves the editor's model shortly after each edit, and at once when the tab is hidden, the page
 * goes away or the editor is left. Call in an injection context. A failed write keeps the edit
 * pending and is retried with the next one; on unload it asks the browser to hold the page.
 */
export function createEditorAutosave({ model, save, enabled }: AutosaveOptions): EditorAutosave {
  const saved = signal(untracked(model));
  const failure = signal<LocalBilletErrorCode | null>(null);
  const paused = signal(false);
  const timer = createSaveTimer(() => flush());

  const status = computed<SaveStatus>(() => {
    if (failure()) return 'error';
    if (model() === saved()) return 'saved';
    return paused() ? 'held' : 'pending';
  });

  function flush(force = false): boolean {
    timer.cancel();
    const document = model();
    if (!enabled() || paused()) return document === saved();
    if (!force && document === saved() && failure() === null) return true;
    try {
      save(document);
      saved.set(document);
      failure.set(null);
      return true;
    } catch (error) {
      failure.set(error instanceof LocalBilletError ? error.code : 'LOCAL_STORAGE_UNAVAILABLE');
      return false;
    }
  }

  effect(() => {
    const document = model();
    if (enabled() && !paused() && document !== untracked(saved)) timer.touch();
  });

  const stopListening = flushOnPageLeave(inject(DOCUMENT).defaultView, flush);
  inject(DestroyRef).onDestroy(() => {
    flush();
    stopListening();
  });

  return {
    status,
    failure: failure.asReadonly(),
    flush,
    markSaved(document: BilletDocument): void {
      timer.cancel();
      saved.set(document);
      failure.set(null);
    },
    paused,
  };
}
