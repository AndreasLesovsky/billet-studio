import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { FontRef, FontRole } from '../../../billet/billet-document';
import { fontStack } from '../../../billet/typography';
import { billetPresetFor } from '../../../core/theme/billet-theme-presets.generated';
import type { ColorMode } from '../../../core/theme/theme-registry.generated';

// Sizes of the mini billet at FontRef.size 1; hero line 2 is relative to the title, as in a billet.
const TITLE_REM = 1.25;
const BODY_REM = 0.625;
const PARTICLE_DOTS = 4;

type Styles = Record<string, string>;

function fontStyle(ref: FontRef, role: FontRole, rem: number, color: string): Styles {
  return {
    color,
    'font-family': fontStack(ref, role),
    'font-weight': String(ref.weight),
    'font-style': ref.italic ? 'italic' : 'normal',
    'font-size': `${rem * ref.size}rem`,
  };
}

/**
 * A theme's billet preset as a mini billet in `mode` (.ui-theme-card): page and hero colours, the
 * title faces, a body line and the particle colours. A picture of the preset (aria-hidden): the
 * caller names it. Its colours and fonts are preset data, bound inline. Unknown ids show the
 * default theme.
 */
@Component({
  selector: 'app-preset-card',
  imports: [TranslatePipe],
  host: {
    class: 'ui-theme-card',
    'aria-hidden': 'true',
    '[style.background-color]': 'card().background',
  },
  templateUrl: './preset-card.html',
  styleUrl: './preset-card.scss',
})
export class PresetCard {
  readonly themeId = input.required<string>();
  readonly mode = input.required<ColorMode>();

  protected readonly card = computed(() => {
    const { palette, typography, particleColors } = billetPresetFor(this.themeId());
    const colors = palette[this.mode()];
    const titleRem = TITLE_REM * typography.title.size;
    return {
      background: colors.background,
      hero: colors.accentSoft,
      title: fontStyle(typography.title, 'title', TITLE_REM, colors.ink),
      titleAccent: fontStyle(typography.titleAccent, 'titleAccent', titleRem, colors.accent),
      body: fontStyle(typography.body, 'body', BODY_REM, colors.inkSoft),
      particles: particleColors.slice(0, PARTICLE_DOTS),
    };
  });
}
