import { Injectable, signal } from '@angular/core';
import { AppMessage } from '../models/app-message';

const MAX_TOASTS = 4;
/** The same code within this window is one event reported twice (e.g. two failing requests). */
const DUPLICATE_WINDOW_MS = 1000;

/**
 * The toast queue. A message is a code, rendered as MESSAGES.<TYPE>.<code>: the error ones come from
 * errorInterceptor, success/info from the *-api services, never from components' own strings.
 */
@Injectable({ providedIn: 'root' })
export class MessageStore {
  private readonly list = signal<AppMessage[]>([]);
  private idCounter = 0;
  private readonly recentMessages = new Map<string, number>();

  readonly messages = this.list.asReadonly();

  addMessage(
    type: AppMessage['type'],
    code: string,
    status?: number,
    params?: Record<string, unknown>,
  ): void {
    const now = Date.now();
    const lastShown = this.recentMessages.get(code);
    if (lastShown !== undefined && now - lastShown < DUPLICATE_WINDOW_MS) {
      return;
    }
    this.recentMessages.set(code, now);
    this.forgetOldCodes(now);

    this.push({ id: ++this.idCounter, type, code, status, params });
  }

  /**
   * The session warning: one at a time, its progress bar runs the whole window instead of the usual
   * few seconds, and it survives a burst of other toasts because being there later is its whole job.
   *
   * A warning already showing THIS deadline stays untouched: the toast list tracks by id, so a new id
   * rebuilds the element - slide-in and progress bar start over while the mm:ss keeps counting.
   */
  showSessionWarning(code: string, endsAt: number): void {
    if (this.sessionWarningEndsAt() === endsAt) return;
    this.dismissSessionWarning();
    this.push({
      id: ++this.idCounter,
      type: 'warning',
      code,
      countdownFrom: Date.now(),
      countdownTo: endsAt,
    });
  }

  /** The deadline the standing warning belongs to, or null when none is showing. */
  sessionWarningEndsAt(): number | null {
    return this.list().find((m) => m.countdownTo !== undefined)?.countdownTo ?? null;
  }

  /** After a renewal there is nothing left to warn about. */
  dismissSessionWarning(): void {
    this.list.update((list) => list.filter((m) => m.countdownTo === undefined));
  }

  removeMessage(id: number): void {
    this.list.update((list) => list.filter((m) => m.id !== id));
  }

  private push(msg: AppMessage): void {
    this.list.update((list) => {
      const updated = [...list, msg];
      if (updated.length > MAX_TOASTS) {
        // The oldest ordinary toast goes first; the session warning is the last to leave.
        const oldest = updated.findIndex((m) => m.countdownTo === undefined);
        updated.splice(oldest === -1 ? 0 : oldest, 1);
      }
      return updated;
    });
  }

  private forgetOldCodes(now: number): void {
    for (const [code, timestamp] of this.recentMessages) {
      if (now - timestamp > DUPLICATE_WINDOW_MS) {
        this.recentMessages.delete(code);
      }
    }
  }
}
