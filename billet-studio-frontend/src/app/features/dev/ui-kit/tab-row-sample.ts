import { Component, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TooltipAnchor } from '../../../shared/directives/tooltip-anchor';
import { moveTabFocus } from './roving-tabs';

type SampleTab = 'content' | 'design' | 'spacing' | 'scene' | 'particles';

interface SampleTabDef {
  readonly id: SampleTab;
  readonly labelKey: string;
  readonly icon: string;
}

/**
 * The editor's tab row beside two columns (features/editor/editor.ts). The stylesheet gives it the
 * editor's widths, which were measured on these labels.
 */
const TABS: readonly SampleTabDef[] = [
  { id: 'content', labelKey: 'EDITOR.TABS.CONTENT', icon: 'bi-body-text' },
  { id: 'design', labelKey: 'EDITOR.TABS.DESIGN', icon: 'bi-palette' },
  { id: 'spacing', labelKey: 'EDITOR.TABS.SPACING', icon: 'bi-distribute-vertical' },
  { id: 'scene', labelKey: 'EDITOR.TABS.SCENE', icon: 'bi-badge-3d' },
  { id: 'particles', labelKey: 'EDITOR.TABS.PARTICLES', icon: 'bi-stars' },
];

/**
 * Dev ui-kit only: a tab row that fits its own width (styles/_tabs.scss) in a box the reader
 * resizes by its corner, so its tiers - side by side, stacked, icons with their names as
 * tooltips - can be seen live.
 */
@Component({
  selector: 'app-tab-row-sample',
  imports: [TooltipAnchor, TranslatePipe],
  templateUrl: './tab-row-sample.html',
  styleUrl: './tab-row-sample.scss',
})
export class TabRowSample {
  protected readonly tabs = TABS;
  protected readonly active = signal<SampleTab>('content');

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    moveTabFocus(event, this.tabs, index, this.active);
  }
}
