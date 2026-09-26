import { Component, computed } from '@angular/core';

import { FieldSkeleton } from '../../shared/components/field-skeleton/field-skeleton';
import { injectEditorLayout } from './editor-layout';

/** Tabs per layout, as the editor shows them (editor.ts, TABS_BY_LAYOUT). */
const TAB_COUNTS = { wide: 4, medium: 5, narrow: 6 } as const;

/**
 * The editor while its billet loads (CLAUDE.md, "Loading states"): the toolbar's row as the layout
 * fills it (for an account billet, the only one that loads: no sign-in), the tab bar, the content
 * panel's first two cards, and - where the layout shows them - the preview's device and the
 * inspector, in the Editor's layout (its stylesheet, its host class).
 */
@Component({
  selector: 'app-editor-skeleton',
  imports: [FieldSkeleton],
  templateUrl: './editor-skeleton.html',
  styleUrls: ['./editor.scss', './editor-skeleton.scss'],
  host: {
    '[class]': "'editor--' + layout()",
    'aria-hidden': 'true',
  },
})
export class EditorSkeleton {
  protected readonly layout = injectEditorLayout();
  protected readonly tabs = computed(() =>
    Array.from({ length: TAB_COUNTS[this.layout()] }, (_, i) => i),
  );
  private readonly narrow = computed(() => this.layout() === 'narrow');
  protected readonly tabBarClass = computed(() =>
    this.narrow() ? 'ui-editor-bar ui-editor-bar--bottom' : 'ui-tabs',
  );
  protected readonly tabClass = computed(() =>
    this.narrow() ? 'ui-tab ui-tab--stacked editor-skeleton__tab' : 'ui-tab editor-skeleton__tab',
  );
}
