import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { AuthApi } from './auth-api';
import { AccessToken } from './access-token';
import { MessageStore } from '../stores/message-store';

/** How long before the end the warning appears, clamped below so a short window still gets one. */
const LEAD_MS = 5 * 60 * 1000;

/**
 * Waited out AFTER the deadline, never before. A check that lands a moment early would renew the
 * session of someone who has walked away, which is what the idle window exists to prevent.
 */
const GRACE_MS = 2000;

/**
 * Counts the server's deadline down and ends the session when it is over. Without it nothing notices
 * an expiry on a page that sits still: guards run on navigation only, so the tab would keep showing
 * a protected route with no session behind it until some request happened to fail.
 */
@Injectable({ providedIn: 'root' })
export class SessionClock {
  private readonly auth = inject(AuthApi);
  private readonly accessToken = inject(AccessToken);
  private readonly messageStore = inject(MessageStore);
  private readonly destroyRef = inject(DestroyRef);

  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // A renewal in ANOTHER tab reaches AccessToken through the storage event, so both cases replan
    // through this one signal. A side effect (timers), not a signal write.
    effect(() => this.planFor(this.accessToken.endsAt()));

    // Background tabs get their timers throttled, so warning and check can arrive late or stale.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        this.planFor(this.accessToken.endsAt(), { wake: true });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      this.clearTimers();
    });
  }

  private planFor(endsAt: number | null, opts?: { wake: boolean }): void {
    this.clearTimers();
    // A warning about THIS deadline is still true and stays, so a tab switch does not rebuild it.
    // untracked: reading the message list plainly would make the effect above replan on every toast.
    if (untracked(() => this.messageStore.sessionWarningEndsAt()) !== endsAt) {
      untracked(() => this.messageStore.dismissSessionWarning());
    }
    if (endsAt === null) return;

    const remaining = endsAt - Date.now();
    this.endTimer = setTimeout(() => this.verify(), Math.max(0, remaining) + GRACE_MS);

    // Past due, e.g. a tab back from sleep: a warning would flash and be overtaken by the check.
    if (remaining <= 0) return;

    // A FRESH window (a new deadline arrived) is warned about at most half-way in, or a shortened
    // lifetime would be warned about from its first second. A WAKE is different: the tab slept
    // through the scheduled warning, so whatever is left is shown at once and in full.
    const lead = opts?.wake ? Math.min(LEAD_MS, remaining) : Math.min(LEAD_MS, remaining / 2);
    this.warnTimer = setTimeout(
      () => this.messageStore.showSessionWarning('SESSION_ENDING', endsAt),
      remaining - lead,
    );
  }

  /**
   * The local deadline is a hint, not a verdict: another tab may have renewed long ago, and logging
   * out on that assumption would take the active tab down with it through the storage event. So the
   * server is asked, and what its answer means is not decided here.
   */
  private verify(): void {
    if (!this.auth.isLoggedIn()) return;
    void this.auth.renewInUse().catch(() => undefined);
  }

  private clearTimers(): void {
    if (this.warnTimer) clearTimeout(this.warnTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.warnTimer = null;
    this.endTimer = null;
  }
}
