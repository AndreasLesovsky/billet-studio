import { STANDARD_DROPDOWN_BELOW_POSITIONS } from '@angular/cdk/overlay';
import { computed, ElementRef, inject, OutputEmitterRef, Signal, signal } from '@angular/core';

/**
 * Open state and focus rules of the pickers whose choices sit in a popover (colour, font, emoji).
 * The panel is a CDK connected overlay placed inline after the trigger (`usePopover: 'inline'`).
 * The template binds `expanded()` to `cdkConnectedOverlayOpen`, `detached()` to `(detach)`,
 * `close()` to `(overlayOutsideClick)` and `focusOut()` to `(focusout)` of both the host and the
 * panel. The trigger's id is `<id>-trigger`, the panel's `<id>-panel`.
 */
class PickerPopover {
  readonly positions = STANDARD_DROPDOWN_BELOW_POSITIONS;
  /** Bound to cdkConnectedOverlayOpen: a disabled control never shows its panel. */
  readonly expanded: Signal<boolean>;

  private readonly open = signal(false);

  constructor(
    private readonly id: string,
    private readonly host: HTMLElement,
    disabled: Signal<boolean>,
    private readonly touch: OutputEmitterRef<void>,
  ) {
    this.expanded = computed(() => this.open() && !disabled());
  }

  isOpen(): boolean {
    return this.open();
  }

  toggle(): void {
    this.open.update((open) => !open);
  }

  show(): void {
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  /** Closes after a choice and hands focus back to the trigger. */
  done(): void {
    this.open.set(false);
    this.host.ownerDocument.getElementById(`${this.id}-trigger`)?.focus();
  }

  /** Every close ends here; only Esc, which the overlay handles itself, still has `open` set. */
  detached(): void {
    if (this.open()) this.done();
  }

  /** Focus left the control and its panel: `touch`, and close unless the page took it. */
  focusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    // Inline, the panel is inside the host; where popovers are missing it is in the overlay container.
    const panel = this.host.ownerDocument.getElementById(`${this.id}-panel`);
    if (this.host.contains(next) || panel?.contains(next)) return;
    this.touch.emit();
    // A click that focuses nothing (a Safari button, the page) is the outside click's to handle.
    if (next) this.close();
  }
}

/** The popover of the picker component being created; call in its field initializers. */
export function injectPickerPopover(
  id: string,
  disabled: Signal<boolean>,
  touch: OutputEmitterRef<void>,
): PickerPopover {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  return new PickerPopover(id, host, disabled, touch);
}

/** aria-labelledby of a picker trigger: the label, then the trigger's own text (its value). */
export function triggerLabelledBy(
  id: string,
  label: string,
  ariaLabelledby: string | null,
): string | null {
  const name = ariaLabelledby ?? (label ? `${id}-label` : null);
  return name ? `${name} ${id}-trigger` : null;
}
