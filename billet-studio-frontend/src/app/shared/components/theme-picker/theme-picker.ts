import { Component, computed, ElementRef, inject, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DEFAULT_THEME,
  isThemeId,
  THEMES,
  ThemeId,
} from '../../../core/theme/theme-registry.generated';
import { ThemeScope } from '../../directives/theme-scope';

// Radio names must be unique per instance, or two pickers on one page share one group.
let nextPickerId = 0;

/**
 * Editor-theme selection as a Signal Forms control: `[formField]="billetForm.theme"` or standalone
 * `[(value)]`. One native radio group (fieldset + legend), so arrow keys, roving focus and "n of m"
 * announcements come from the browser. Each card previews its theme in the site's current colour
 * mode through ThemeScope; the name and the selection frame stay in the site theme.
 *
 * An unknown value shows the default theme as selected without writing it back; the value changes
 * only when the user picks a card.
 */
@Component({
  selector: 'app-theme-picker',
  imports: [TranslatePipe, ThemeScope],
  templateUrl: './theme-picker.html',
  styleUrl: './theme-picker.scss',
})
export class ThemePicker implements FormValueControl<string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly value = model<string>(DEFAULT_THEME);
  readonly disabled = input(false);
  /** Focus left the picker: marks a bound field as touched. */
  readonly touch = output<void>();

  protected readonly themes = THEMES;
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
