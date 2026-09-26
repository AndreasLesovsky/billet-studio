import {
  DestroyRef,
  Directive,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Drives a native `<dialog>` from bound state: `showModal()` when `appModal` turns true (focus trap,
 * Esc, inert page from the browser), `close()` when it turns false, focus back to whatever opened it.
 *
 * The owner keeps the state. Esc and a backdrop click only ASK to close (`dismissed`); the owner
 * decides, e.g. not while an action is running. `closed` fires once the dialog is off screen, after
 * its closing transition, so content bound to it can be cleared without flashing empty.
 */
@Directive({ selector: 'dialog[appModal]' })
export class Modal {
  private readonly dialog = inject<ElementRef<HTMLDialogElement>>(ElementRef).nativeElement;

  /** Whether the dialog belongs on screen. */
  readonly open = input.required<boolean>({ alias: 'appModal' });

  /** Esc, a backdrop click, or a close the browser forced: the owner should set `open` to false. */
  readonly dismissed = output<void>();

  /** Closed and its closing transition finished. */
  readonly closed = output<void>();

  private returnFocusTo: HTMLElement | null = null;
  /** The owner is gone (it navigated away while the dialog was closing): nothing to report to. */
  private destroyed = false;

  constructor() {
    const abort = new AbortController();
    const { signal } = abort;

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      abort.abort();
      if (this.dialog.open) {
        this.dialog.close();
        this.restoreFocus();
      }
    });

    // Esc fires `cancel` first. Cancelled here, so the dialog closes only through `open`.
    this.dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        this.dismissed.emit();
      },
      { signal },
    );

    this.dialog.addEventListener(
      'close',
      () => {
        // Still meant to be open: the browser closed it anyway (a repeated Esc without user
        // activation cannot be cancelled), so the owner has to catch up.
        if (this.open()) this.dismissed.emit();
        this.restoreFocus();
        void this.afterTransition();
      },
      { signal },
    );

    // Both ends of the gesture on the backdrop, so a text selection dragged out of the dialog does
    // not count as a click outside it.
    let pressedOutside = false;
    this.dialog.addEventListener(
      'pointerdown',
      (event) => (pressedOutside = this.isBackdrop(event)),
      { signal },
    );
    this.dialog.addEventListener(
      'click',
      (event) => {
        if (pressedOutside && this.isBackdrop(event)) this.dismissed.emit();
        pressedOutside = false;
      },
      { signal },
    );

    // showModal() needs the element in the document, which the render phase guarantees.
    afterRenderEffect({
      write: () => {
        const open = this.open();
        if (open && !this.dialog.open) {
          const active = this.dialog.ownerDocument.activeElement;
          this.returnFocusTo = active instanceof HTMLElement ? active : null;
          this.dialog.showModal();
        } else if (!open && this.dialog.open) {
          this.dialog.close();
        }
      },
    });
  }

  /** The backdrop is the dialog element itself, outside its own box. */
  private isBackdrop(event: MouseEvent): boolean {
    if (event.target !== this.dialog) return false;
    const box = this.dialog.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }

  /** Back to the opener, unless the user has already moved on to something else. */
  private restoreFocus(): void {
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    const active = this.dialog.ownerDocument.activeElement;
    const focusIsLost = !active || active === this.dialog.ownerDocument.body;
    if (target?.isConnected && (focusIsLost || this.dialog.contains(active))) {
      target.focus();
    }
  }

  private async afterTransition(): Promise<void> {
    const running = this.dialog.getAnimations?.({ subtree: true }) ?? [];
    await Promise.allSettled(running.map((animation) => animation.finished));
    // Reopened during the fade-out: the content now belongs to the next opening.
    if (!this.dialog.open && !this.destroyed) this.closed.emit();
  }
}
