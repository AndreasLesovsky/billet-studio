import {
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  signal,
  untracked,
  type Injector,
  type Signal,
  type WritableSignal,
} from '@angular/core';

import type { BilletDocument } from '../../billet/billet-document';
import type { BilletSaveResponse } from '../../core/models/models';
import { apiErrorCode, isUnreachable } from '../../core/utils/api-error';
import { removeBackup, writeBackup } from './billet-backup';
import { createSaveTimer, flushOnPageLeave } from './save-timer';

/** Waits before the next attempt while the server cannot be reached; the last one repeats. */
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16_000, 30_000] as const;

/**
 * idle: the server has what is on screen. dirty: an edit waits for its save. error: the last save
 * failed (see `failure`). conflict: the billet was saved elsewhere meanwhile; nothing is sent
 * until the user decides.
 */
export type SaveState = 'idle' | 'dirty' | 'saving' | 'error' | 'conflict';

/** offline: the server could not be reached, retried by itself. rejected: it refused the save. */
export type SaveFailure = 'offline' | 'rejected';

export interface SaveCoordinatorOptions {
  readonly billetId: number;
  readonly userId: number;
  /** The loaded version, whose document `model` shows right now. */
  readonly version: number;
  readonly model: Signal<BilletDocument>;
  /** `refusedBefore`: the previous attempt was refused (not merely unreachable). */
  readonly save: (
    version: number,
    document: BilletDocument,
    refusedBefore: boolean,
  ) => Promise<BilletSaveResponse>;
  /** False once the session the billet was opened in is gone: nothing is sent, the backup stays. */
  readonly canSave: () => boolean;
  /** Its DestroyRef ends the coordinator (with a last flush). */
  readonly injector: Injector;
}

const isConflict = (error: unknown) => apiErrorCode(error) === 'BILLET_MODIFIED_ELSEWHERE';

/**
 * Saves one account billet (CLAUDE.md section 23): shortly after each edit and at least every
 * 10 s while editing, at once when the tab is hidden or the page goes, one request at a time, each
 * carrying the version the previous one returned. Before every send the document goes into this
 * device's backup, which a successful save of the document on screen removes again.
 */
export class BilletSaveCoordinator {
  readonly state: Signal<SaveState>;
  /** Why the state is `error`; null otherwise. */
  readonly failure: Signal<SaveFailure | null>;
  /** The version the next save carries: the latest the server answered. */
  readonly version: Signal<number>;

  private readonly options: SaveCoordinatorOptions;
  private readonly model: Signal<BilletDocument>;
  private readonly latestVersion: WritableSignal<number>;
  /** The document the server has, as last confirmed. */
  private readonly saved: WritableSignal<BilletDocument>;
  private readonly inFlight = signal(false);
  private readonly failed = signal<SaveFailure | null>(null);
  private readonly conflicted = signal(false);
  private readonly timer = createSaveTimer(() => this.flush());
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  /** A flush arrived while a request was out: the next one follows its answer. */
  private again = false;
  /** The request out right now; a follow-up replaces it when it starts. */
  private sending: Promise<void> | null = null;
  private disposed = false;
  private readonly stopWatching: () => void;
  private unregister: (() => void) | null;

  constructor(options: SaveCoordinatorOptions) {
    this.options = options;
    this.model = options.model;
    this.latestVersion = signal(options.version);
    this.version = this.latestVersion.asReadonly();
    this.saved = signal(untracked(options.model));
    this.failure = this.failed.asReadonly();
    this.state = computed<SaveState>(() => {
      if (this.conflicted()) return 'conflict';
      if (this.failed()) return 'error';
      if (this.inFlight()) return 'saving';
      return this.model() === this.saved() ? 'idle' : 'dirty';
    });
    this.stopWatching = this.watch(options.injector);
    // Unregistered only when disposed early: a hook removing itself while the injector runs its
    // hooks would make it skip the next one.
    this.unregister = options.injector.get(DestroyRef).onDestroy(() => {
      this.unregister = null;
      this.dispose();
    });
  }

  /**
   * Backs up what is unsaved and sends it now, when a request may go. True when leaving now loses
   * nothing: the server has the document, or this device's backup does.
   */
  flush(): boolean {
    this.timer.cancel();
    const document = this.model();
    if (document === this.saved()) {
      // Edited back to what the server has: nothing is left to save or to retry.
      if (!this.inFlight()) this.settle();
      return true;
    }
    const backedUp = this.backUp(document);
    if (this.inFlight()) this.again = true;
    else if (this.mayStart()) this.start(document);
    return backedUp;
  }

  /**
   * Sends what is pending and waits until nothing is on its way, follow-ups included. Resolves
   * with the state then: 'idle' when the server has the document on screen at `version()`.
   */
  async settled(): Promise<SaveState> {
    this.flush();
    while (this.sending) await this.sending;
    return this.state();
  }

  /**
   * Another request based on `version()` was refused as stale (a publish): the billet was saved
   * elsewhere, and the user decides as after a save that lost the race.
   */
  markConflict(): void {
    this.conflicted.set(true);
    this.timer.cancel();
  }

  /** Resolves a conflict for the document on screen: saves it over the server's `latestVersion`. */
  keepMine(latestVersion: number): void {
    this.latestVersion.set(latestVersion);
    this.conflicted.set(false);
    const document = this.model();
    this.backUp(document);
    if (!this.inFlight() && this.mayStart()) this.start(document);
  }

  /** Resolves a conflict for the server's copy, which the editor now shows at `version`. */
  reset(version: number, document: BilletDocument): void {
    this.timer.cancel();
    this.settle();
    this.again = false;
    this.latestVersion.set(version);
    this.saved.set(document);
    this.conflicted.set(false);
    removeBackup(this.options.userId, this.options.billetId);
  }

  /** Flushes and stops: for the billet that is being left. Also runs when the injector goes. */
  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    this.timer.cancel();
    clearTimeout(this.retryTimer);
    this.stopWatching();
    this.unregister?.();
  }

  /** Edits schedule a save; a hidden tab, a leaving page and a returning network flush. */
  private watch(injector: Injector): () => void {
    const watcher = effect(
      () => {
        if (this.model() !== untracked(this.saved)) this.timer.touch();
      },
      { injector },
    );
    const view = injector.get(DOCUMENT).defaultView;
    const stopFlushing = flushOnPageLeave(view, () => this.flush());
    const online = new AbortController();
    view?.addEventListener(
      'online',
      () => {
        if (this.retryTimer !== undefined) this.retryNow();
      },
      { signal: online.signal },
    );
    return () => {
      watcher.destroy();
      stopFlushing();
      online.abort();
    };
  }

  /** Not while the user decides a conflict, nor while waiting to retry: the retry sends. */
  private mayStart(): boolean {
    return (
      !this.disposed &&
      !this.conflicted() &&
      this.retryTimer === undefined &&
      this.options.canSave()
    );
  }

  private start(document: BilletDocument): void {
    const request = this.send(document);
    this.sending = request;
    void request.then(() => {
      if (this.sending === request) this.sending = null;
    });
  }

  /** Never rejects: a failure becomes the state. */
  private async send(document: BilletDocument): Promise<void> {
    this.inFlight.set(true);
    const refusedBefore = this.failed() === 'rejected';
    if (refusedBefore) this.failed.set(null);
    let response: BilletSaveResponse;
    try {
      response = await this.options.save(this.latestVersion(), document, refusedBefore);
    } catch (error) {
      this.inFlight.set(false);
      this.fail(error);
      return;
    }
    this.inFlight.set(false);
    this.latestVersion.set(response.version);
    this.saved.set(document);
    this.settle();
    if (this.model() === document) removeBackup(this.options.userId, this.options.billetId);
    if (this.disposed) return;
    if (this.again) {
      this.again = false;
      this.flush();
    } else if (this.model() !== document && !this.timer.pending) {
      this.timer.touch();
    }
  }

  private fail(error: unknown): void {
    this.again = false;
    if (isConflict(error)) {
      this.markConflict();
    } else if (isUnreachable(error)) {
      this.failed.set('offline');
      this.retryLater();
    } else {
      // Sent again with the next edit or flush; the same document would get the same answer.
      this.failed.set('rejected');
    }
  }

  private retryLater(): void {
    if (this.disposed) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
    this.retries++;
    this.retryTimer = setTimeout(() => this.retryNow(), delay);
  }

  private retryNow(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.flush();
  }

  private settle(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retries = 0;
    this.failed.set(null);
  }

  private backUp(document: BilletDocument): boolean {
    const { userId, billetId } = this.options;
    return writeBackup(userId, billetId, this.latestVersion(), document);
  }
}
