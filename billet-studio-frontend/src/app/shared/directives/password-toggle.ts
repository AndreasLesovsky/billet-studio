import {
  DestroyRef,
  Directive,
  ElementRef,
  Renderer2,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';

/**
 * Adds a show/hide button to every password input it is imported for. The button is inserted right
 * after the input and placed over the input's end by `.ui-password-toggle` (src/styles), so the
 * field markup stays a plain `.ui-field` > label + input.
 *
 * A toggle button (aria-pressed) with one constant label, so the name does not change under the
 * user's finger. Submitting the form hides the password again, so the browser never stores it from a
 * plain text field.
 */
@Directive({
  selector: 'input[type=password]',
  host: {
    '[attr.type]': 'visible() ? "text" : "password"',
  },
})
export class PasswordToggle {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);

  protected readonly visible = signal(false);

  private readonly button = this.renderer.createElement('button') as HTMLButtonElement;
  private readonly icon = this.renderer.createElement('i') as HTMLElement;

  constructor() {
    const abort = new AbortController();
    const destroyRef = inject(DestroyRef);

    this.button.type = 'button';
    this.button.className = 'ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-password-toggle';
    this.icon.setAttribute('aria-hidden', 'true');
    this.renderer.appendChild(this.button, this.icon);
    this.show(false);

    inject(TranslateService)
      .stream('COMMON.SHOW_PASSWORD')
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((label: string) => this.button.setAttribute('aria-label', label));

    this.button.addEventListener('click', () => this.show(!this.visible()), {
      signal: abort.signal,
    });

    // Not in the constructor: an input inside an @if block is not attached to its parent yet.
    afterNextRender(() => {
      const parent = this.input.parentNode;
      if (!parent) return;
      if (this.input.id) this.button.setAttribute('aria-controls', this.input.id);
      this.renderer.insertBefore(parent, this.button, this.input.nextSibling);
      this.input.form?.addEventListener('submit', () => this.show(false), {
        signal: abort.signal,
      });
    });

    // Angular removes only the nodes it created; the button would outlive its input.
    destroyRef.onDestroy(() => {
      abort.abort();
      this.button.remove();
    });
  }

  private show(visible: boolean): void {
    this.visible.set(visible);
    this.button.setAttribute('aria-pressed', String(visible));
    this.icon.className = visible ? 'bi bi-eye-slash' : 'bi bi-eye';
  }
}
