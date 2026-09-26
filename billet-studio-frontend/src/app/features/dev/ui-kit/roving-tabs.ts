import type { WritableSignal } from '@angular/core';

/** Index of the tab a key moves to (arrows wrap, Home/End jump), or null for other keys. */
function targetTab(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Roving focus for a ui-kit tablist (WAI-ARIA tabs pattern, automatic activation): the tab a key
 * moves to becomes `active` and takes the focus. Other keys pass through.
 */
export function moveTabFocus<T>(
  event: KeyboardEvent,
  tabs: readonly { readonly id: T }[],
  index: number,
  active: WritableSignal<T>,
): void {
  const next = targetTab(event.key, index, tabs.length);
  if (next === null) return;
  event.preventDefault();
  active.set(tabs[next].id);
  const tablist = (event.currentTarget as HTMLElement).parentElement;
  tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}
