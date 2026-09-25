import { Component, computed, inject, input, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { applyThemePreset, COLOR_MODES } from '../../../../billet/billet-document';
import {
  DEFAULT_THEME,
  THEMES,
  type ColorMode,
} from '../../../../core/theme/theme-registry.generated';
import { ThemePicker } from '../../../../shared/components/theme-picker/theme-picker';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';
import { matchesThemePreset } from './design-edits';
import { PaletteEditor } from './palette-editor';
import { TypographyEditor } from './typography-editor';

const COLOR_MODE_KEYS = {
  auto: 'EDITOR.DESIGN.COLOR_MODES.AUTO',
  light: 'EDITOR.DESIGN.COLOR_MODES.LIGHT',
  dark: 'EDITOR.DESIGN.COLOR_MODES.DARK',
} as const;

const THEME_NAME_KEYS: ReadonlyMap<string, string> = new Map(THEMES.map((t) => [t.id, t.nameKey]));

/**
 * The inspector's design tab: theme and colour mode, the palette, the typography. A theme is picked
 * as one undo step that rewrites palette, typography and particle colours from its preset, so the
 * picker is bound to the document, not to the theme field. The sixteen theme cards fold away behind
 * the current theme's name and show their presets in the palette the preview shows. Inputs and
 * commands: see EditorPanel.
 */
@Component({
  selector: 'app-design-panel',
  imports: [FormField, PaletteEditor, ThemePicker, TranslatePipe, TypographyEditor],
  templateUrl: './design-panel.html',
  styleUrl: './design-panel.scss',
})
export class DesignPanel extends EditorPanel {
  private readonly commands = inject(EditorCommands);

  /** The palette the preview shows the billet in. */
  readonly previewColorMode = input.required<ColorMode>();

  protected readonly colorModes = COLOR_MODES.map((mode) => ({
    mode,
    labelKey: COLOR_MODE_KEYS[mode],
  }));
  protected readonly themesOpen = signal(false);
  protected readonly themeNameKey = computed(
    () => THEME_NAME_KEYS.get(this.document().theme) ?? THEME_NAME_KEYS.get(DEFAULT_THEME)!,
  );
  /** The billet's own main colours beside the theme name, as the preview shows them. */
  protected readonly swatches = computed(() => {
    const { accent, accentSoft, background, ink } =
      this.document().palette[this.previewColorMode()];
    return [accent, accentSoft, background, ink];
  });
  /** Nothing to reset while the billet still has its theme's colours and fonts. */
  protected readonly matchesTheme = computed(() => matchesThemePreset(this.document()));

  protected toggleThemes(): void {
    this.themesOpen.update((open) => !open);
  }

  protected pickTheme(themeId: string): void {
    if (themeId === this.document().theme) return;
    this.commands.commit((document) => applyThemePreset(document, themeId));
  }

  protected resetToTheme(): void {
    this.commands.commit((document) => applyThemePreset(document, document.theme));
  }
}
