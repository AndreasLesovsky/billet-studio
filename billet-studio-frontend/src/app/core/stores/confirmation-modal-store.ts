import { Injectable, signal } from '@angular/core';

export interface ConfirmationModalConfig {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Maps to .ui-btn--primary / .ui-btn--danger on the confirm button. */
  confirmVariant: 'primary' | 'danger';
  onConfirm: () => Promise<void>;
}

/**
 * Drives the ONE confirmation dialog the app renders (the app shell hosts it). Two ways in: `open`
 * with a callback, `askConfirmation` for callers that need the decision as a value.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmationModalStore {
  readonly isOpen = signal(false);
  readonly config = signal<ConfirmationModalConfig | null>(null);
  readonly isExecuting = signal(false);

  private pendingAnswer: ((answer: boolean) => void) | null = null;

  open(config: ConfirmationModalConfig): void {
    // A second question while one is open answers the first with "no" instead of orphaning it.
    this.settle(false);
    this.config.set(config);
    this.isOpen.set(true);
  }

  /** Resolves true on confirm, false on cancel, Esc and the close button. */
  askConfirmation(config: Omit<ConfirmationModalConfig, 'onConfirm'>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.open({ ...config, onConfirm: async () => this.settle(true) });
      this.pendingAnswer = resolve;
    });
  }

  /** Asks for it to close. What it shows stays until it is off screen. */
  close(): void {
    // After confirm() this runs a second time; settle has already fired and ignores it. Without that
    // guard every confirmed answer would be overwritten by a false on the way out.
    this.settle(false);
    this.isOpen.set(false);
    this.isExecuting.set(false);
  }

  /** Closed and gone: the text may go now. Settles too, for a dismissal that skipped close(). */
  onHidden(): void {
    this.settle(false);
    this.config.set(null);
  }

  async confirm(): Promise<void> {
    const cfg = this.config();
    if (!cfg) return;

    this.isExecuting.set(true);
    try {
      await cfg.onConfirm();
      this.close();
    } catch {
      // The failure toast comes from errorInterceptor; the dialog stays open for another try.
    } finally {
      this.isExecuting.set(false);
    }
  }

  private settle(answer: boolean): void {
    const resolve = this.pendingAnswer;
    this.pendingAnswer = null;
    resolve?.(answer);
  }
}
