import { DestroyRef, DOCUMENT, inject, signal, type Signal } from '@angular/core';

export const PREFERS_DARK = '(prefers-color-scheme: dark)';
export const PREFERS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** A mouse or trackpad that hovers: where a pointer parallax makes sense. */
export const FINE_HOVER = '(hover: hover) and (pointer: fine)';

/**
 * A media query as a live signal, read from the viewer's system. The billet follows the system
 * itself, never the site's colour-mode setting (CLAUDE.md §9). Call in an injection context.
 */
export function mediaQuery(query: string): Signal<boolean> {
  const list = inject(DOCUMENT).defaultView?.matchMedia(query);
  const matches = signal(!!list?.matches);
  const abort = new AbortController();
  list?.addEventListener('change', (event) => matches.set(event.matches), { signal: abort.signal });
  inject(DestroyRef).onDestroy(() => abort.abort());
  return matches.asReadonly();
}

/** Chromium's Network Information API; other browsers never report a data saver. */
export function prefersSaveData(view: Window | null): boolean {
  const navigator = view?.navigator as
    (Navigator & { connection?: { saveData?: boolean } }) | undefined;
  return navigator?.connection?.saveData === true;
}
