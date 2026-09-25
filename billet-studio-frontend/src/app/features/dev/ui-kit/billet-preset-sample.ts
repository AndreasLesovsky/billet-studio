import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { FONT_BY_ID, FontCatalogEntry } from '../../../billet/fonts/font-catalog.generated';
import {
  billetPresetFor,
  BilletThemePreset,
} from '../../../core/theme/billet-theme-presets.generated';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { ColorMode } from '../../../core/theme/theme-registry.generated';

type PresetPalette = BilletThemePreset['palette'][ColorMode];
type PresetFont = BilletThemePreset['typography']['body'];

const PALETTE_KEYS: readonly (keyof PresetPalette)[] = [
  'accent',
  'accentSoft',
  'border',
  'background',
  'ink',
  'inkSoft',
  'surface',
];

const PALETTES: readonly { readonly mode: ColorMode; readonly labelKey: string }[] = [
  { mode: 'light', labelKey: 'COLOR_MODE.LIGHT' },
  { mode: 'dark', labelKey: 'COLOR_MODE.DARK' },
];

// Sample sizes at FontRef.size 1, scaled down from the billet's role sizes to fit a kit tile.
const TITLE_REM = 2.25;
const BODY_REM = 1;

const FONTS: ReadonlyMap<string, FontCatalogEntry> = FONT_BY_ID;

function fontStyle(font: PresetFont, rem: number): Record<string, string> {
  return {
    'font-family': FONTS.get(font.fontId)?.fallback ?? 'serif',
    'font-weight': String(font.weight),
    'font-style': font.italic ? 'italic' : 'normal',
    'font-size': `${rem * font.size}rem`,
  };
}

/**
 * Dev ui-kit only: the billet preset of one theme - both palettes as swatches, and hero
 * line 2 plus a paragraph in the preset's fonts and colours, in the site's current colour mode.
 * Preset colours are data, so they are bound inline here; the billet renderer binds them as
 * --billet-* tokens on its root instead.
 */
@Component({
  selector: 'app-billet-preset-sample',
  imports: [TranslatePipe],
  templateUrl: './billet-preset-sample.html',
  styleUrl: './billet-preset-sample.scss',
})
export class BilletPresetSample {
  private readonly colorMode = inject(ColorModeService);

  /** Theme id; an unknown id shows the default theme's preset. */
  readonly themeId = input.required<string>();

  private readonly preset = computed(() => billetPresetFor(this.themeId()));

  protected readonly palettes = computed(() => {
    const { palette } = this.preset();
    return PALETTES.map(({ mode, labelKey }) => ({
      mode,
      labelKey,
      swatches: PALETTE_KEYS.map((key) => ({
        key,
        color: palette[mode][key],
        label: `${key} ${palette[mode][key]}`,
      })),
    }));
  });

  protected readonly sample = computed(() => {
    const { palette, typography } = this.preset();
    const colors = palette[this.colorMode.resolvedMode()];
    return {
      page: {
        'background-color': colors.background,
        color: colors.ink,
        border: `1px solid ${colors.border}`,
      },
      hero: {
        'background-color': colors.accentSoft,
        color: colors.accent,
        // Hero line 2 is sized relative to the title (docs/billet-document.md).
        ...fontStyle(typography.titleAccent, TITLE_REM * typography.title.size),
      },
      body: fontStyle(typography.body, BODY_REM),
      emphasis: typography.emphasis === 'accent' ? colors.accent : colors.inkSoft,
    };
  });
}
