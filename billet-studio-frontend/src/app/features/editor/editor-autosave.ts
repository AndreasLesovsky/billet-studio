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

/** Quiet time after the last edit before it is written (CLAUDE.md section 23). */
const SAVE_DELAY_MS = 1200;
/** Longest an edit waits while typing goes on. */
const SAVE_MAX_WAIT_MS = 10_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince: number | null = null;

  const status = computed<SaveStatus>(() => {
    if (failure()) return 'error';
    if (model() === saved()) return 'saved';
    return paused() ? 'held' : 'pending';
  });

  function schedule(): void {
    const now = Date.now();
    pendingSince ??= now;
    clearTimeout(timer);
    const wait = Math.min(SAVE_DELAY_MS, SAVE_MAX_WAIT_MS - (now - pendingSince));
    timer = setTimeout(() => flush(), Math.max(0, wait));
  }

  function flush(force = false): boolean {
    clearTimeout(timer);
    pendingSince = null;
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
    if (enabled() && !paused() && document !== untracked(saved)) schedule();
  });

  const view = inject(DOCUMENT).defaultView;
  const abort = new AbortController();
  const listen = (target: EventTarget | null | undefined, type: string, fn: (e: Event) => void) =>
    target?.addEventListener(type, fn, { signal: abort.signal });
  listen(view?.document, 'visibilitychange', () => {
    if (view?.document.visibilityState === 'hidden') flush();
  });
  listen(view, 'pagehide', () => flush());
  listen(view, 'beforeunload', (event) => {
    if (!flush()) event.preventDefault();
  });
  inject(DestroyRef).onDestroy(() => {
    flush();
    abort.abort();
  });

  return {
    status,
    failure: failure.asReadonly(),
    flush,
    markSaved(document: BilletDocument): void {
      clearTimeout(timer);
      pendingSince = null;
      saved.set(document);
      failure.set(null);
    },
    paused,
  };
}
