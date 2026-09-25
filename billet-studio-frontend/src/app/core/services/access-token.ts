import { Injectable, signal } from '@angular/core';

/**
 * Marks that this browser has a session. A hint, never an authority - the refresh cookie is
 * unreadable from here, and without it every anonymous visitor would fire a /refresh on startup.
 *
 * Its VALUE is when the session ends, epoch ms, so a renewal in one tab is a storage event in all
 * the others and their clocks replan instead of counting down to a deadline that has moved.
 */
export const SESSION_HINT_KEY = 'billet-studio.session';

/**
 * The access token, in memory only - an injected script can read localStorage, a variable dies with
 * the tab. Zero dependencies on purpose: authTokenInterceptor injects it and must not gain a path
 * into AuthApi (see the DI deadlock rule there).
 */
@Injectable({ providedIn: 'root' })
export class AccessToken {
  private readonly token = signal<string | null>(null);

  /** When the session ends, epoch ms. Read by SessionClock; written only through set()/clear(). */
  readonly endsAt = signal<number | null>(readHint());

  constructor() {
    // Only the value change is handled here. The removal means logout, and AuthApi owns that.
    window.addEventListener('storage', (e) => {
      if (e.key === SESSION_HINT_KEY && e.newValue !== null) {
        this.endsAt.set(Number(e.newValue) || null);
      }
    });
  }

  get(): string | null {
    return this.token();
  }

  /** After a login or a refresh. Also arms the hint, so the next page load knows to ask again. */
  set(token: string, expiresInSeconds?: number): void {
    this.token.set(token);
    const endsAt = expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : null;
    this.endsAt.set(endsAt);
    localStorage.setItem(SESSION_HINT_KEY, String(endsAt ?? ''));
  }

  /** Clearing the hint also signals the other tabs, via the storage event. */
  clear(): void {
    this.token.set(null);
    this.endsAt.set(null);
    localStorage.removeItem(SESSION_HINT_KEY);
  }

  /** Whether a session is worth asking for: a token in hand, or a hint that one can be had. */
  couldHaveSession(): boolean {
    return this.token() !== null || readRawHint() !== null;
  }
}

function readRawHint(): string | null {
  try {
    return localStorage.getItem(SESSION_HINT_KEY);
  } catch {
    // Storage blocked (private mode, sandboxed frame): no hint means no session to restore.
    return null;
  }
}

function readHint(): number | null {
  return Number(readRawHint()) || null;
}
