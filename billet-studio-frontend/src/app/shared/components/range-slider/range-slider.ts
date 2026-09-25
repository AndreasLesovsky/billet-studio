import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { LanguageService } from '../../../core/services/language-service';

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;

let nextId = 0;

/** Decimal places of a step (0.25 → 2), so the default readout shows what the slider can hit. */
function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

/**
 * A number on a native `input[type=range]` as a Signal Forms control: `[formField]` or standalone
 * `[(value)]`. Bound to a form, `min` and `max` come from the field's schema rules (`min()` /
 * `max()`); standalone they are plain inputs (default 0..100). The readout and aria-valuetext use
 * `valueText` (e.g. '2.25 rem · 36 px'), else the number in the UI locale. With a `defaultValue`,
 * a reset button returns to it; it stays visible and is disabled while the value is the default.
 * `defaultLoading` holds the places of the reset button and the marks while their data still loads.
 */
@Component({
  selector: 'app-range-slider',
  imports: [TranslatePipe],
  templateUrl: './range-slider.html',
  styleUrl: './range-slider.scss',
  host: { class: 'ui-field', '(focusout)': 'onFocusOut($event)' },
})
export class RangeSlider implements FormValueControl<number> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly language = inject(LanguageService);

  readonly value = model<number>(0);
  readonly disabled = input(false);
  readonly min = input<number | undefined>(undefined);
  readonly max = input<number | undefined>(undefined);
  readonly step = input(1);
  /** Visible label text; or name the slider with `ariaLabelledby`. */
  readonly label = input('');
  readonly ariaLabelledby = input<string | null>(null);
  /** Formats a value for the readout and for assistive tech. */
  readonly valueText = input<((value: number) => string) | null>(null);
  /** Values to mark under the track. */
  readonly marks = input<readonly number[]>([]);
  readonly defaultValue = input<number | null>(null);
  /** The default and the marks are still loading (the slider itself works meanwhile). */
  readonly defaultLoading = input(false);
  /** Focus left the control: marks a bound field as touched. */
  readonly touch = output<void>();

  private readonly range = viewChild.required<ElementRef<HTMLInputElement>>('range');

  protected readonly id = `app-range-slider-${nextId++}`;
  protected readonly low = computed(() => this.min() ?? DEFAULT_MIN);
  protected readonly high = computed(() => Math.max(this.low(), this.max() ?? DEFAULT_MAX));

  private readonly format = computed(() => {
    const custom = this.valueText();
    if (custom) return custom;
    const digits = decimalsOf(this.step());
    const numbers = new Intl.NumberFormat(this.language.locale(), {
      maximumFractionDigits: digits,
    });
    return (value: number) => numbers.format(value);
  });

  protected readonly text = computed(() => this.format()(this.value()));
  protected readonly defaultText = computed(() => {
    const fallback = this.defaultValue();
    return fallback === null ? '' : this.format()(fallback);
  });
  protected readonly atDefault = computed(() => this.value() === this.defaultValue());

  private readonly share = (value: number) => {
    const span = this.high() - this.low();
    return span > 0 ? Math.min(1, Math.max(0, (value - this.low()) / span)) : 0;
  };
  protected readonly progress = computed(() => `${this.share(this.value()) * 100}%`);
  protected readonly markPositions = computed(() =>
    this.marks().map((mark) => ({ mark, at: `${this.share(mark) * 100}%` })),
  );

  focus(options?: FocusOptions): void {
    this.range().nativeElement.focus(options);
  }

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(next)) this.value.set(next);
  }

  protected restoreDefault(): void {
    const fallback = this.defaultValue();
    if (fallback === null) return;
    this.value.set(fallback);
    // The button disables itself now; keep focus on the slider instead of dropping it.
    this.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.host.contains(event.relatedTarget as Node | null)) this.touch.emit();
  }
}
