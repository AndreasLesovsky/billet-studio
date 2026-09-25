import { Component, computed, ElementRef, inject, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import type { FontRef, FontRole } from '../../../billet/billet-document';
import { fontStack } from '../../../billet/typography';
import {
  billetPresetFor,
  type BilletThemePreset,
} from '../../../core/theme/billet-theme-presets.generated';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import {
  DEFAULT_THEME,
  isThemeId,
  THEMES,
  type ColorMode,
  type ThemeId,
} from '../../../core/theme/theme-registry.generated';

// Radio names must be unique per instance, or two pickers on one page share one group.
let nextPickerId = 0;

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

/** A card's mini billet: page and hero colours, the three sample lines and the particle dots. */
function presetCard({ palette, typography, particleColors }: BilletThemePreset, mode: ColorMode) {
  const colors = palette[mode];
  const titleRem = TITLE_REM * typography.title.size;
  return {
    background: colors.background,
    hero: colors.accentSoft,
    title: fontStyle(typography.title, 'title', TITLE_REM, colors.ink),
    titleAccent: fontStyle(typography.titleAccent, 'titleAccent', titleRem, colors.accent),
    body: fontStyle(typography.body, 'body', BODY_REM, colors.inkSoft),
    particles: particleColors.slice(0, PARTICLE_DOTS),
  };
}

/**
 * Theme selection as a Signal Forms control: `[formField]="billetForm.theme"` or standalone
 * `[(value)]`. One native radio group (fieldset + legend), so arrow keys, roving focus and "n of m"
 * announcements come from the browser. A theme is a billet design preset: each card is a mini
 * billet of its preset (page, hero, title fonts, body line, particle colours) in `mode`, by default
 * the site's colour mode. Frame, name and selection ring are Studio like the rest of the UI.
 *
 * An unknown value shows the default theme as selected without writing it back; the value changes
 * only when the user picks a card.
 */
@Component({
  selector: 'app-theme-picker',
  imports: [TranslatePipe],
  templateUrl: './theme-picker.html',
  styleUrl: './theme-picker.scss',
})
export class ThemePicker implements FormValueControl<string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly colorMode = inject(ColorModeService);

  readonly value = model<string>(DEFAULT_THEME);
  readonly disabled = input(false);
  /** The palette the cards show; defaults to the site's resolved colour mode. */
  readonly mode = input<ColorMode>();
  /** Focus left the picker: marks a bound field as touched. */
  readonly touch = output<void>();

  protected readonly cards = computed(() => {
    const mode = this.mode() ?? this.colorMode.resolvedMode();
    return THEMES.map(({ id, nameKey }) => ({
      id,
      nameKey,
      ...presetCard(billetPresetFor(id), mode),
    }));
  });
  protected readonly selected = computed<ThemeId>(() => {
    const value = this.value();
    return isThemeId(value) ? value : DEFAULT_THEME;
  });
  protected readonly group = `app-theme-picker-${nextPickerId++}`;

  /** Focuses the selected card's radio, e.g. when a form focuses its first invalid field. */
  focus(options?: FocusOptions): void {
    this.host.querySelector<HTMLInputElement>('input:checked')?.focus(options);
  }

  protected select(id: ThemeId): void {
    this.value.set(id);
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.host.contains(event.relatedTarget as Node | null)) this.touch.emit();
  }
}
