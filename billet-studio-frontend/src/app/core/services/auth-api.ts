import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UserWithTokenDto } from '../models/userWithTokenDto';
import { LoginRequestDto } from '../models/loginRequestDto';
import { AppMessage } from '../models/app-message';
import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import { AccessToken, SESSION_HINT_KEY } from './access-token';
import { UnsavedWork } from './unsaved-work';

/** Where a login without a (valid) returnUrl lands, for every role. */
export const POST_LOGIN_ROUTE = '/billets';

export type EndSessionReason = 'expired' | 'logout' | 'deactivated' | 'multi-tab';

const END_SESSION_TOASTS: Record<EndSessionReason, Pick<AppMessage, 'type' | 'code'> | null> = {
  expired: { type: 'error', code: 'SESSION_EXPIRED' },
  logout: { type: 'success', code: 'LOGOUT_SUCCESS' },
  'multi-tab': { type: 'info', code: 'SESSION_ENDED_BY_OTHER_TAB' },
  // No toast: the caller has shown its domain message already.
  deactivated: null,
};

/**
 * What one renewal established about the session it was started for.
 *
 * `inconclusive` covers both "the server could not be reached" and "this answer is about a session
 * that has since ended": neither is a statement about the session in front of the user, and no
 * caller reacts differently to them, so they are one value rather than two nobody can tell apart.
 */
export type RenewalOutcome = 'renewed' | 'over' | 'inconclusive';

/**
 * Renew on activity once this much of the SESSION window has passed. A fraction of the window the
 * server just reported, so no lifetime is duplicated here.
 *
 * Half, and SessionClock warns at most half a window ahead - so whenever the warning is on screen
 * the throttle is open, and touching the page always renews.
 */
const RENEW_AFTER = 0.5;

const ACTIVITY_EVENTS = ['click', 'keydown', 'wheel', 'touchstart'] as const;

/** "The server says there is no session" - as opposed to "the server could not be reached". */
function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}

interface RenewalFlight {
  mark: symbol;
  outcome: Promise<RenewalOutcome>;
  abort: () => void;
}

/**
 * The session, from the frontend's side.
 *
 * Two credentials, and this service only ever handles one of them. The access token lives in
 * {@link AccessToken}, in memory. The refresh token is an httpOnly cookie: it is never read, never
 * written and never seen here - the browser attaches it by itself, and sessionCookieInterceptor
 * decides which calls are allowed to send and receive it.
 *
 * DI deadlock rule: nothing injected here (directly or transitively) may inject LanguageService or
 * TranslateService. refreshTokenInterceptor injects this service, and their constructors fire an
 * HTTP request through that interceptor.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly messageStore = inject(MessageStore);
  private readonly accessToken = inject(AccessToken);
  private readonly unsavedWork = inject(UnsavedWork);
  private readonly authApi = `${baseUrl}auth`;

  /**
   * Collapses concurrent renewals. Five requests failing at once must produce ONE call to /refresh,
   * not five - the others await this one. It carries the mark it was started under, so a caller
   * belonging to a later session starts its own instead of joining this.
   */
  private flight: RenewalFlight | null = null;

  /** Replaced by every session change. Only ever compared, never read for a value. */
  private sessionMark = Symbol('session');

  /**
   * Open while a call is REPLACING this device's refresh cookie. A renewal started inside that
   * window travels with the cookie the server is throwing away, so its 401 would read as an expiry
   * and end a session that is being renewed, not lost.
   */
  private rotating = false;

  /** When the session last moved forward, and how long it was given. Drive the activity renewal. */
  private lastRenewAt = 0;
  private sessionWindowMs: number | null = null;

  /**
   * The page an EXPIRING session left, and whose it was. A guard writes a returnUrl for whoever is
   * at the keyboard and that one is anyone's; this one belongs to the user it ended, and another
   * account logging in on the same tab must not inherit it. Same ownership rule as UnsavedWork.
   */
  private returnIntent: { url: string; userId: number } | null = null;

  readonly user = signal<UserWithTokenDto | null>(null);
  readonly role = signal<string | null>(null);
  readonly isLoggedIn = computed(() => this.user() !== null);

  constructor() {
    // Multi-tab logout: another tab clearing the session hint means its session ended, so this one
    // follows.
    window.addEventListener('storage', (e) => {
      if (e.key === SESSION_HINT_KEY && e.newValue === null && this.user() !== null) {
        this.endSession({ reason: 'multi-tab' });
      }
    });

    // capture so a stopPropagation() cannot silence it; passive because a non-passive wheel listener
    // blocks scrolling.
    const options: AddEventListenerOptions = { capture: true, passive: true };
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, this.renewOnActivity, options);
    }
  }

  private readonly renewOnActivity = (): void => {
    if (!this.isLoggedIn()) return;
    if (this.sessionWindowMs === null) return;
    if (Date.now() - this.lastRenewAt < this.sessionWindowMs * RENEW_AFTER) return;

    void this.renewInUse().catch(() => undefined);
  };

  /**
   * Names the session running right now, for a caller that has to come back to it after an await.
   * Carry it into {@link renewInUse}; it answers no question by itself.
   */
  markSession(): symbol {
    return this.sessionMark;
  }

  /**
   * Startup, and every guarded navigation that finds no loaded user. Asks only when this browser
   * might have a session, so an anonymous visitor causes no auth traffic at all.
   *
   * The silent policy: it clears, and it never toasts and never navigates. The page behind it may be
   * perfectly public, and while a guard is waiting on this, the guard is the only thing allowed to
   * redirect.
   */
  async restoreSession(): Promise<void> {
    if (!this.accessToken.couldHaveSession()) return;
    try {
      if ((await this.renew(this.sessionMark)) === 'over') {
        this.clearTokens();
      }
    } catch {
      // clearTokens writes localStorage, which throws when storage is disabled or full. This runs
      // inside provideAppInitializer, where a rejection is a blank page.
    }
  }

  /**
   * The loud policy, and the only place that turns a dead session into a toast and a trip to the
   * login page. `mark` names the session the caller belongs to: an interceptor takes it when the
   * request goes out, because by the time a 401 comes back the session may be someone else's.
   */
  async renewInUse(mark: symbol = this.sessionMark): Promise<RenewalOutcome> {
    const outcome = await this.renew(mark);
    // Five requests failing at once share ONE renewal and all five read 'over'. The first to react
    // ends the session, which moves the mark; the others are then holding an answer about a session
    // that is already gone, and a second run would toast again and overwrite the return intent.
    if (outcome === 'over' && mark === this.sessionMark) {
      // Clearing is unconditional, announcing is not. A session the server has disowned must not
      // survive locally, or the hint keeps routing every following request down the renewal branch.
      if (this.isLoggedIn()) {
        // Not plain router.url: during an activation that still names the route being LEFT.
        const here = this.router.currentNavigation()?.finalUrl?.toString() ?? this.router.url;
        this.endSession({ reason: 'expired', returnUrl: here });
      } else {
        this.clearTokens();
      }
    }
    return outcome;
  }

  /**
   * One renewal, classified in one place. It reports and never reacts: the same answer reaches a
   * silent startup probe and a save in mid-flight, and only they know what it means.
   */
  private renew(mark: symbol): Promise<RenewalOutcome> {
    // The caller belongs to a session that has already ended, so its answer says nothing about
    // whoever is here now.
    if (mark !== this.sessionMark) return Promise.resolve('inconclusive');
    // A rotation is mid-way through replacing the cookie a renewal would travel with.
    if (this.rotating) return Promise.resolve('inconclusive');
    return (this.flight ?? this.startFlight()).outcome;
  }

  private startFlight(): RenewalFlight {
    const mark = this.sessionMark;
    // Stamped on the attempt, not on the answer: a renewal that fails leaves applySession unrun, so
    // an old stamp would let every following click and scroll tick fire another one.
    this.lastRenewAt = Date.now();

    let abort = (): void => undefined;
    const outcome = new Promise<RenewalOutcome>((resolve) => {
      const subscription = this.http
        .post<UserWithTokenDto>(
          `${this.authApi}/refresh`,
          {},
          {
            // The outcome is answered by whoever asked for it - silently at startup, with a toast
            // mid-use. A toast from here would fire on both.
            context: new HttpContext().set(SKIP_ERROR_TOAST, true),
          },
        )
        .subscribe({
          next: (response) => {
            if (this.sessionMark !== mark) {
              resolve('inconclusive');
              return;
            }
            try {
              this.applySession(response);
              resolve('renewed');
            } catch {
              // applySession writes localStorage. A browser that refuses it has not told us anything
              // about the session.
              resolve('inconclusive');
            }
          },
          error: (error: unknown) => {
            if (this.sessionMark !== mark) {
              resolve('inconclusive');
              return;
            }
            resolve(isUnauthorized(error) ? 'over' : 'inconclusive');
          },
        });
      // Unsubscribing aborts the request itself. Forgetting the promise would not: its Set-Cookie
      // would still arrive and hand the browser back a session the user has just left.
      abort = (): void => {
        subscription.unsubscribe();
        resolve('inconclusive');
      };
    });

    const flight: RenewalFlight = { mark, outcome, abort };
    this.flight = flight;
    void outcome.then(() => {
      // Only its own slot. A session change may have replaced it while this one was on the wire.
      if (this.flight === flight) this.flight = null;
    });
    return flight;
  }

  /**
   * Every change of WHICH session this tab holds goes through here. A renewal in flight belonged to
   * the session being left, so it is abandoned rather than allowed to answer for the next one.
   *
   * A successful renewal is not a change: it continues the same session, and moving the mark there
   * would declare every other caller of the same renewal superseded.
   */
  private advanceSession(): void {
    this.sessionMark = Symbol('session');
    const outgoing = this.flight;
    this.flight = null;
    outgoing?.abort();
  }

  /**
   * Runs a call that REPLACES this device's refresh cookie server-side: a password change ends every
   * session of the account and hands the caller a new one in the same response.
   *
   * Renew first, rotate second, never both at once. The call needs a live access token like any other
   * request, and a page left open past the token's fifteen minutes no longer has one - so the renewal
   * happens here, before the call leaves, and not through the interceptor after its 401, which the
   * window below would refuse. Once the call is out no renewal may start: one that leaves while the
   * server rotates travels with the cookie being thrown away.
   *
   * The window belongs here and not to the callers: the activity renewal is a document-level click
   * listener, and the click that submits the form IS that click.
   */
  async rotateCredential<T>(call: () => Promise<T>): Promise<T> {
    // Joins a renewal already on the wire instead of racing it.
    if ((await this.renewInUse()) === 'over') {
      // renewInUse has already ended the session, toast and login page included. Sent now, the call
      // would carry no token and come back as a 401 that errorInterceptor toasts as a wrong password.
      throw new Error('The session ended before the credential could be rotated');
    }
    this.rotating = true;
    try {
      return await call();
    } finally {
      this.rotating = false;
    }
  }

  /** Pure state clearing. No toast, no navigation - the caller owns the UX response. */
  clearTokens(): void {
    this.advanceSession();
    this.accessToken.clear();
    this.user.set(null);
    this.role.set(null);
  }

  /**
   * Single entry point for "session has ended" with UI feedback: clears state, shows the toast that
   * matches the reason, and navigates to /login.
   */
  endSession(opts: { reason: EndSessionReason; returnUrl?: string }): void {
    // Read before clearTokens() forgets who this was.
    const outgoingUserId = this.user()?.id;
    this.returnIntent =
      opts.reason === 'expired' && opts.returnUrl && outgoingUserId !== undefined
        ? { url: opts.returnUrl, userId: outgoingUserId }
        : null;

    // Clearing goes first because it is the part that must not be skippable. keepAll runs each
    // registered form's own capture(), so it can throw; keeping the work is the part that may fail.
    this.clearTokens();
    // Here rather than at any one call site: several paths end a session, and each would otherwise
    // drop whatever the open form was holding.
    this.unsavedWork.keepAll();

    const toast = END_SESSION_TOASTS[opts.reason];
    if (toast) {
      this.messageStore.addMessage(toast.type, toast.code);
    }

    if (opts.returnUrl) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: opts.returnUrl } });
    } else {
      void this.router.navigate(['/login']);
    }
  }

  /**
   * Whether the login page may follow this returnUrl for the user who just logged in. Spent on
   * the first answer: a return intent outlives exactly one login attempt, whoever makes it.
   */
  returnUrlBelongsTo(url: string, userId: number | undefined): boolean {
    const intent = this.returnIntent;
    this.returnIntent = null;
    return intent === null || intent.url !== url || intent.userId === userId;
  }

  async login(dto: LoginRequestDto): Promise<UserWithTokenDto | null> {
    const response = await firstValueFrom(
      this.http.post<UserWithTokenDto>(`${this.authApi}/login`, dto),
    );

    if (!response?.accessToken) {
      return null;
    }

    // Signing in as someone else without signing out first is supported, so this is where the
    // previous session is left. After the success check: a failed attempt leaves whoever is signed
    // in alone.
    this.advanceSession();
    this.applySession(response);
    this.messageStore.addMessage('success', 'LOGIN_SUCCESS');
    if (response.reactivated) {
      this.messageStore.addMessage('info', 'ACCOUNT_REACTIVATED');
    }
    return response;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.authApi}/logout`,
          {},
          // The server may already consider the session gone, and local state is cleared either way,
          // so its answer is nothing to tell the user about.
          { context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
        ),
      );
    } catch {
      // See above.
    } finally {
      this.endSession({ reason: 'logout' });
    }
  }

  private applySession(response: UserWithTokenDto): void {
    this.accessToken.set(response.accessToken, response.expiresInSeconds);
    this.user.set(response);
    this.role.set(response.role);
    // Every path that moves the session forward comes through here, so the activity throttle is
    // fed by logins, startup and interceptor renewals alike - not just by its own firing.
    this.lastRenewAt = Date.now();
    this.sessionWindowMs = response.expiresInSeconds ? response.expiresInSeconds * 1000 : null;
    this.unsavedWork.setOwner(response.id);
  }

  async forgotPassword(email: string): Promise<void> {
    await firstValueFrom(this.http.post(`${this.authApi}/forgot-password`, { email }));
    this.messageStore.addMessage('success', 'PASSWORD_RESET_EMAIL_SENT');
  }

  async resetPassword(token: string, newPassword: string, confirmPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.authApi}/reset-password`, { token, newPassword, confirmPassword }),
    );
    this.messageStore.addMessage('success', 'PASSWORD_RESET_SUCCESS');
  }

  /**
   * Patch the cached user after an avatar upload/removal, so the header avatar updates without a
   * round trip.
   */
  patchAvatar(avatarUrl: string | null): void {
    this.user.update((u) => (u ? { ...u, avatarUrl } : u));
  }

  /** Patch the cached user after the account name changed, so the header shows the new one. */
  patchName(name: string): void {
    this.user.update((u) => (u ? { ...u, name } : u));
  }
}
