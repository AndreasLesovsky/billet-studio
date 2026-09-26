/** Quiet time after the last edit before it is written (CLAUDE.md section 23). */
const SAVE_DELAY_MS = 1200;
/** Longest an edit waits while typing goes on. */
const SAVE_MAX_WAIT_MS = 10_000;

export interface SaveTimer {
  /** An edit: `run` follows after a pause in editing, and during non-stop editing every 10 s. */
  touch(): void;
  /** Forgets the pending run (it is done now, or not wanted). */
  cancel(): void;
  /** Whether a run is waiting. */
  readonly pending: boolean;
}

/** The autosave's rhythm, shared by the device and the account saver. */
export function createSaveTimer(run: () => void): SaveTimer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince: number | null = null;

  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pendingSince = null;
  };

  return {
    touch(): void {
      const now = Date.now();
      pendingSince ??= now;
      clearTimeout(timer);
      const wait = Math.min(SAVE_DELAY_MS, SAVE_MAX_WAIT_MS - (now - pendingSince));
      timer = setTimeout(
        () => {
          cancel();
          run();
        },
        Math.max(0, wait),
      );
    },
    cancel,
    get pending(): boolean {
      return timer !== undefined;
    },
  };
}

/**
 * Flushes when the tab is hidden or the page goes away; a flush that leaves work unsecured on
 * unload asks the browser to hold the page. Returns what stops listening.
 */
export function flushOnPageLeave(view: Window | null, flush: () => boolean): () => void {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  view?.document.addEventListener(
    'visibilitychange',
    () => {
      if (view.document.visibilityState === 'hidden') flush();
    },
    options,
  );
  view?.addEventListener('pagehide', () => flush(), options);
  view?.addEventListener(
    'beforeunload',
    (event) => {
      if (!flush()) event.preventDefault();
    },
    options,
  );
  return () => abort.abort();
}
