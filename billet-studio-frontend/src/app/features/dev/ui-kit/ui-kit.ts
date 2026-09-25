import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { DatePipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ThemePicker } from '../../../shared/components/theme-picker/theme-picker';

type KitTab = 'content' | 'design' | 'scene';

interface TabDef {
  readonly id: KitTab;
  readonly labelKey: string;
  readonly panelKey: string;
  readonly icon: string;
}

const TABS: readonly TabDef[] = [
  {
    id: 'content',
    labelKey: 'UI_KIT.TAB_CONTENT',
    panelKey: 'UI_KIT.PANEL_CONTENT',
    icon: 'bi-type',
  },
  {
    id: 'design',
    labelKey: 'UI_KIT.TAB_DESIGN',
    panelKey: 'UI_KIT.PANEL_DESIGN',
    icon: 'bi-palette',
  },
  { id: 'scene', labelKey: 'UI_KIT.TAB_SCENE', panelKey: 'UI_KIT.PANEL_SCENE', icon: 'bi-box' },
];

const SAMPLE_ROWS = [
  {
    titleKey: 'UI_KIT.OCCASION_MOTHERS_DAY',
    statusKey: 'UI_KIT.STATUS_PUBLISHED',
    badge: 'ui-badge--success',
    updatedAt: '2026-05-08T09:30:00Z',
  },
  {
    titleKey: 'UI_KIT.OCCASION_BIRTHDAY',
    statusKey: 'UI_KIT.STATUS_DRAFT',
    badge: 'ui-badge--muted',
    updatedAt: '2026-06-14T17:05:00Z',
  },
  {
    titleKey: 'UI_KIT.OCCASION_WEDDING',
    statusKey: 'UI_KIT.STATUS_REVIEW',
    badge: 'ui-badge--warning',
    updatedAt: '2026-07-02T11:45:00Z',
  },
] as const;

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
 * Kitchen sink of every ui-* component class in the current theme, for visual QA (route dev/ui).
 * Sample content is static; nothing here talks to the backend.
 */
@Component({
  selector: 'app-ui-kit',
  imports: [TranslatePipe, DatePipe, CdkMenu, CdkMenuItem, CdkMenuTrigger, ThemePicker],
  templateUrl: './ui-kit.html',
  styleUrl: './ui-kit.scss',
})
export class UiKit {
  protected readonly tabs = TABS;
  protected readonly rows = SAMPLE_ROWS;
  protected readonly activeTab = signal<KitTab>('content');
  protected readonly spacing = signal(40);

  protected onSpacing(event: Event): void {
    this.spacing.set(Number((event.target as HTMLInputElement).value));
  }

  /** Roving focus for the tablist (WAI-ARIA tabs pattern, automatic activation). */
  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const next = targetTab(event.key, index, this.tabs.length);
    if (next === null) return;
    event.preventDefault();
    this.activeTab.set(this.tabs[next].id);
    const tablist = (event.currentTarget as HTMLElement).parentElement;
    tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
}
