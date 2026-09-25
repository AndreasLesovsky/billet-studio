import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { THEMES, ThemeId } from '../../../core/theme/theme-registry.generated';
import { ColorModeSetting, ThemeService } from '../../../core/theme/theme-service';

interface ModeOption {
  readonly value: ColorModeSetting;
  readonly labelKey: string;
  readonly icon: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: 'system', labelKey: 'THEME_PICKER.MODE_SYSTEM', icon: 'bi-circle-half' },
  { value: 'light', labelKey: 'THEME_PICKER.MODE_LIGHT', icon: 'bi-sun' },
  { value: 'dark', labelKey: 'THEME_PICKER.MODE_DARK', icon: 'bi-moon-stars' },
];

// Radio names must be unique per instance, or two pickers on one page share one group.
let nextPickerId = 0;

/**
 * Colour mode + theme selection. Both are native radio groups (fieldset + legend), so arrow keys,
 * roving focus and "n of m" announcements come from the browser. Each card previews its own theme
 * by carrying data-theme / data-mode itself.
 */
@Component({
  selector: 'app-theme-picker',
  imports: [TranslatePipe],
  templateUrl: './theme-picker.html',
  styleUrl: './theme-picker.scss',
})
export class ThemePicker {
  private readonly themeService = inject(ThemeService);
  private readonly id = nextPickerId++;

  protected readonly themes = THEMES;
  protected readonly modeOptions = MODE_OPTIONS;
  protected readonly theme = this.themeService.theme;
  protected readonly mode = this.themeService.mode;
  protected readonly previewMode = this.themeService.resolvedMode;
  protected readonly themeGroup = `app-theme-picker-${this.id}-theme`;
  protected readonly modeGroup = `app-theme-picker-${this.id}-mode`;

  protected selectTheme(id: ThemeId): void {
    this.themeService.setTheme(id);
  }

  protected selectMode(mode: ColorModeSetting): void {
    this.themeService.setMode(mode);
  }
}
