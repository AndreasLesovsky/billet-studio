import { computed, Directive, inject, input } from '@angular/core';

import { ColorModeService } from '../../core/theme/color-mode-service';
import {
  ColorMode,
  DEFAULT_THEME,
  isThemeId,
  ThemeId,
} from '../../core/theme/theme-registry.generated';

/**
 * Renders its element, and everything inside it, in one editor theme while the page around it stays
 * in the site theme: data-theme + data-mode select the theme's --ui-* tokens, and .ui-theme-scope
 * (src/styles/_base.scss) re-applies background, text colour and font from them.
 *
 * Editor themes appear ONLY here: on the editor root, on theme-picker cards and in the dev ui-kit.
 * Never on a site page, and never on <html>.
 */
@Directive({
  selector: '[appThemeScope]',
  host: {
    class: 'ui-theme-scope',
    '[attr.data-theme]': 'theme()',
    '[attr.data-mode]': 'mode()',
  },
})
export class ThemeScope {
  private readonly colorMode = inject(ColorModeService);

  /** Editor theme id; an unknown id renders the default theme. */
  readonly appThemeScope = input.required<string>();

  /** Defaults to the site's resolved colour mode, live. */
  readonly themeMode = input<ColorMode>();

  protected readonly theme = computed<ThemeId>(() => {
    const id = this.appThemeScope();
    return isThemeId(id) ? id : DEFAULT_THEME;
  });

  protected readonly mode = computed<ColorMode>(
    () => this.themeMode() ?? this.colorMode.resolvedMode(),
  );
}
