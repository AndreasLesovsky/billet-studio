import { computed, type Signal } from '@angular/core';

import { mediaQuery } from '../../billet/view/media-query';

export type EditorLayout = 'wide' | 'medium' | 'narrow';

// Three columns from 75rem, two from md (48rem, src/styles/_breakpoints.scss), below that one
// panel at a time.
const WIDE_QUERY = '(width >= 75rem)';
const MEDIUM_QUERY = '(width >= 48rem)';

/**
 * The editor's layout on this screen, decided once and styled through the host class
 * (`editor--<layout>`, editor.scss). Call in an injection context.
 */
export function injectEditorLayout(): Signal<EditorLayout> {
  const wide = mediaQuery(WIDE_QUERY);
  const medium = mediaQuery(MEDIUM_QUERY);
  return computed(() => {
    if (wide()) return 'wide';
    return medium() ? 'medium' : 'narrow';
  });
}
