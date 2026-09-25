import { DestroyRef, DOCUMENT, inject, signal, type Signal } from '@angular/core';

export const PREFERS_DARK = '(prefers-color-scheme: dark)';
export const PREFERS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

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
