import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import type { ModelAssetDto } from '../../../core/models/models';
import { LanguageService } from '../../../core/services/language-service';
import { FALLBACK_EMOJI, occasionMeta } from '../../../core/utils/model-occasions';
import { AssetThumb } from '../asset-thumb/asset-thumb';

// Radio names must be unique per instance, or two pickers on one page share one group.
let nextPickerId = 0;

/**
 * The 3D model of a billet as a Signal Forms control (`value` = the model slug): `[formField]` or
 * standalone `[(value)]`. One native radio group (fieldset), so arrow keys, roving focus and "n of
 * m" come from the browser, as in the theme picker. Each option shows the WebP preview and the name
 * in the UI language; the credit is its tooltip. Occasion chips narrow the grid.
 *
 * A slug that is not among `assets` (a retired model) leaves every option unchecked and is never
 * written back.
 */
@Component({
  selector: 'app-asset-picker',
  imports: [AssetThumb, TranslatePipe],
  templateUrl: './asset-picker.html',
  styleUrl: './asset-picker.scss',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class AssetPicker implements FormValueControl<string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly language = inject(LanguageService);

  readonly value = model<string>('');
  readonly disabled = input(false);
  /** The library to choose from. */
  readonly assets = input<readonly ModelAssetDto[]>([]);
  /** Visible legend text; or name the group with `ariaLabelledby`. */
  readonly label = input('');
  readonly ariaLabelledby = input<string | null>(null);
  /** Focus left the control: marks a bound field as touched. */
  readonly touch = output<void>();

  protected readonly group = `app-asset-picker-${nextPickerId++}`;
  protected readonly occasion = signal<string | null>(null);

  protected readonly occasions = computed(() =>
    [...new Set(this.assets().map((a) => a.occasion))].map((key) => ({
      key,
      labelKey: occasionMeta(key)?.labelKey ?? null,
    })),
  );

  protected readonly options = computed(() => {
    const english = this.language.currentLang() === 'en';
    const occasion = this.occasion();
    return this.assets()
      .filter((a) => occasion === null || a.occasion === occasion)
      .map((a) => ({
        slug: a.slug,
        name: english ? a.nameEn : a.nameDe,
        previewUrl: a.previewUrl || null,
        credit: a.credit,
        emoji: occasionMeta(a.occasion)?.emoji ?? FALLBACK_EMOJI,
      }));
  });

  /** Focuses the checked option (else the first), e.g. when a form focuses its first invalid field. */
  focus(options?: FocusOptions): void {
    const radios = this.host.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const checked = [...radios].find((radio) => radio.checked);
    (checked ?? radios[0])?.focus(options);
  }

  protected setOccasion(occasion: string | null): void {
    this.occasion.set(occasion);
  }

  protected select(slug: string): void {
    this.value.set(slug);
  }

  protected onFocusOut(event: FocusEvent): void {
    if (!this.host.contains(event.relatedTarget as Node | null)) this.touch.emit();
  }
}
