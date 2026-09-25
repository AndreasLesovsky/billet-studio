import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { DatePipe } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DEFAULT_THEME,
  THEMES,
  type ColorMode,
} from '../../../core/theme/theme-registry.generated';
import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';
import { ThemePicker } from '../../../shared/components/theme-picker/theme-picker';
import { BilletPresetSample } from './billet-preset-sample';
import { EditorControlsSample } from './editor-controls-sample';

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

/** Every button variant in hierarchy order, shown once enabled and once disabled. */
const BUTTON_VARIANTS = [
  { variant: 'ui-btn--primary', labelKey: 'COMMON.SAVE', icon: 'bi-check2' },
  { variant: 'ui-btn--secondary', labelKey: 'UI_KIT.BUTTON_SHARE', icon: 'bi-share' },
  { variant: 'ui-btn--neutral', labelKey: 'COMMON.CANCEL', icon: null },
  { variant: 'ui-btn--ghost', labelKey: 'UI_KIT.BUTTON_MORE', icon: null },
  { variant: 'ui-btn--danger', labelKey: 'COMMON.DELETE', icon: 'bi-trash3' },
] as const;

/** The theme picker once per palette: the cards preview each preset in light and in dark. */
const PICKER_MODES: readonly { readonly mode: ColorMode; readonly labelKey: string }[] = [
  { mode: 'light', labelKey: 'COLOR_MODE.LIGHT' },
  { mode: 'dark', labelKey: 'COLOR_MODE.DARK' },
];

const BUTTON_STATES = [
  { disabled: false, busy: false, labelKey: 'UI_KIT.BUTTONS_VARIANTS' },
  { disabled: true, busy: false, labelKey: 'UI_KIT.BUTTONS_DISABLED' },
  { disabled: true, busy: true, labelKey: 'UI_KIT.BUTTONS_PENDING' },
] as const;

/** Every variant in every state; while an action runs, a button shows the pending label. */
const BUTTON_ROWS = BUTTON_STATES.map((state) => ({
  ...state,
  buttons: BUTTON_VARIANTS.map((button) => ({
    ...button,
    labelKey: state.busy ? 'COMMON.PENDING.SAVING' : button.labelKey,
  })),
}));

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
 * Kitchen sink for visual QA (route dev/ui): every ui-* component class in the site (Studio) theme,
 * then the billet themes - the theme picker with its preset previews in light and in dark, and each
 * theme's billet preset - then the editor's form controls, fed with the picked theme's preset.
 * Everything is Studio; only the preset previews show a theme. Sample content is static; nothing
 * here talks to the backend.
 */
@Component({
  selector: 'app-ui-kit',
  imports: [
    TranslatePipe,
    DatePipe,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    ThemePicker,
    BilletPresetSample,
    EditorControlsSample,
    AssetThumb,
  ],
  templateUrl: './ui-kit.html',
  styleUrl: './ui-kit.scss',
})
export class UiKit {
  protected readonly tabs = TABS;
  protected readonly rows = SAMPLE_ROWS;
  protected readonly buttonRows = BUTTON_ROWS;
  protected readonly activeTab = signal<KitTab>('content');
  protected readonly spacing = signal(40);
  protected readonly themes = THEMES;
  protected readonly pickerModes = PICKER_MODES;
  protected readonly billetTheme = signal<string>(DEFAULT_THEME);
  protected readonly billetThemeName = computed(
    () => THEMES.find((t) => t.id === this.billetTheme())?.nameKey ?? '',
  );

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
