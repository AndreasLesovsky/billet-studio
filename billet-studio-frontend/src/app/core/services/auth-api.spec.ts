import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AuthApi, EndSessionReason } from './auth-api';
import { SESSION_HINT_KEY } from './access-token';
import { MessageStore } from '../stores/message-store';
import { UnsavedWork } from './unsaved-work';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import {
  createMockMessageStore,
  createMockRouter,
  MockRouter,
  testUser,
} from '../../../test-helpers';
import { UserWithTokenDto } from '../models/userWithTokenDto';

describe('AuthApi', () => {
  let authApi: AuthApi;
  let messageStore: ReturnType<typeof createMockMessageStore>;
  let router: MockRouter;
  let unsavedWork: { keepAll: ReturnType<typeof vi.fn>; setOwner: ReturnType<typeof vi.fn> };
  let httpClient: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    messageStore = createMockMessageStore();
    router = createMockRouter('/initial');
    unsavedWork = { keepAll: vi.fn(), setOwner: vi.fn() };
    httpClient = { get: vi.fn(), post: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        AuthApi,
        { provide: HttpClient, useValue: httpClient },
        { provide: Router, useValue: router },
        { provide: MessageStore, useValue: messageStore },
        { provide: UnsavedWork, useValue: unsavedWork },
      ],
    });
    authApi = TestBed.inject(AuthApi);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('login', () => {
    it('adopts the session, toasts and names the owner of unsaved work', async () => {
      const dto = testUser({ id: 9, role: 'ROLE_ADMIN' });
      httpClient.post.mockReturnValue(of(dto));

      const result = await authApi.login({ email: dto.email, password: 'Secret123' });

      expect(result).toEqual(dto);
      expect(authApi.user()).toEqual(dto);
      expect(authApi.role()).toBe('ROLE_ADMIN');
      expect(authApi.isLoggedIn()).toBe(true);
      expect(localStorage.getItem(SESSION_HINT_KEY)).not.toBeNull();
      expect(unsavedWork.setOwner).toHaveBeenCalledWith(9);
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'LOGIN_SUCCESS');
    });

    it('a reactivated account also hears that its deletion was cancelled', async () => {
      httpClient.post.mockReturnValue(of(testUser({ reactivated: true })));

      await authApi.login({ email: 'a@b.de', password: 'Secret123' });

      expect(messageStore.addMessage).toHaveBeenCalledWith('info', 'ACCOUNT_REACTIVATED');
    });

    it('a failed login leaves whoever is signed in alone and rethrows', async () => {
      authApi.user.set(testUser({ id: 3 }));
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      await expect(authApi.login({ email: 'x@y.de', password: 'nope' })).rejects.toBeInstanceOf(
        HttpErrorResponse,
      );

      expect(authApi.user()?.id).toBe(3);
      expect(messageStore.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('ends the session even when the server call fails, without an error toast', async () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      await authApi.logout();

      const [, , options] = httpClient.post.mock.calls[0] as [
        string,
        unknown,
        { context: HttpRequest<unknown>['context'] },
      ];
      expect(options.context.get(SKIP_ERROR_TOAST)).toBe(true);
      expect(authApi.user()).toBeNull();
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'LOGOUT_SUCCESS');
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('clearTokens', () => {
    it('removes the hint and clears the signals, no toast, no navigate', () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      authApi.user.set(testUser());
      authApi.role.set('ROLE_USER');

      authApi.clearTokens();

      expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
      expect(authApi.user()).toBeNull();
      expect(authApi.role()).toBeNull();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('returnUrlBelongsTo', () => {
    // A session expired on /billets/5/edit; someone else logged in on the same tab. The return
    // intent of an expired session is the ended user's alone.
    it('the page an expired session left belongs to the user it ended', () => {
      authApi.user.set(testUser({ id: 7 }));
      authApi.endSession({ reason: 'expired', returnUrl: '/billets/5/edit' });

      expect(authApi.returnUrlBelongsTo('/billets/5/edit', 7)).toBe(true);
    });

    it("a returnUrl no expiry wrote - a guard deep link - is anyone's", () => {
      expect(authApi.returnUrlBelongsTo('/billets/5/edit', 8)).toBe(true);
    });

    it('and to nobody else on that tab, spent on the first login attempt, whoever makes it', () => {
      authApi.user.set(testUser({ id: 7 }));
      authApi.endSession({ reason: 'expired', returnUrl: '/billets/5/edit' });

      expect(authApi.returnUrlBelongsTo('/billets/5/edit', 8)).toBe(false);
      expect(authApi.returnUrlBelongsTo('/billets/5/edit', 8)).toBe(true);
    });

    it('a logout writes no intent: it carries no returnUrl to begin with', () => {
      authApi.user.set(testUser({ id: 7 }));
      authApi.endSession({ reason: 'logout' });

      expect(authApi.returnUrlBelongsTo('/billets/5/edit', 8)).toBe(true);
    });
  });

  describe('endSession', () => {
    const toLogin = [['/login']];
    it.each<[EndSessionReason, string | undefined, unknown[][], unknown[]]>([
      [
        'expired',
        '/account',
        [['error', 'SESSION_EXPIRED']],
        [['/login'], { queryParams: { returnUrl: '/account' } }],
      ],
      ['expired', undefined, [['error', 'SESSION_EXPIRED']], toLogin],
      ['logout', undefined, [['success', 'LOGOUT_SUCCESS']], toLogin],
      ['deactivated', undefined, [], toLogin],
      ['multi-tab', undefined, [['info', 'SESSION_ENDED_BY_OTHER_TAB']], toLogin],
    ])(
      '%s (returnUrl %s): clears the session, toasts %j, opens the login',
      (reason, returnUrl, toasts, navigation) => {
        localStorage.setItem(SESSION_HINT_KEY, '1');
        authApi.user.set(testUser());

        authApi.endSession({ reason, returnUrl });

        expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
        expect(authApi.user()).toBeNull();
        expect(messageStore.addMessage.mock.calls).toEqual(toasts);
        expect(router.navigate).toHaveBeenCalledWith(...navigation);
      },
    );

    it('keeps the open work of whoever was signed in', () => {
      authApi.user.set(testUser());

      authApi.endSession({ reason: 'expired' });

      expect(unsavedWork.keepAll).toHaveBeenCalledOnce();
    });

    it('clears the session even when keeping the open work throws', () => {
      // keepAll runs each registered form's own capture(). With it running first, a throw there
      // left the session standing: nothing cleared, no toast, no navigation.
      localStorage.setItem(SESSION_HINT_KEY, '1');
      authApi.user.set(testUser());
      unsavedWork.keepAll.mockImplementation(() => {
        throw new Error('capture() blew up');
      });

      expect(() => authApi.endSession({ reason: 'expired' })).toThrow();

      expect(authApi.user()).toBeNull();
      expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    });
  });

  describe('another tab', () => {
    it('logging out there logs this tab out too', () => {
      authApi.user.set(testUser());

      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_HINT_KEY, newValue: null }));

      expect(authApi.user()).toBeNull();
      expect(messageStore.addMessage).toHaveBeenCalledWith('info', 'SESSION_ENDED_BY_OTHER_TAB');
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('a signed-out tab ignores it', () => {
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_HINT_KEY, newValue: null }));

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('restoreSession', () => {
    it('asks for nothing when this browser has no session hint', async () => {
      // Every anonymous visitor runs this on startup. One pointless 401 per visit would be noise in
      // the logs and a rate-limit bucket spent on nobody.
      await authApi.restoreSession();

      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('with a hint: renews without an error toast (its caller decides) and adopts the session', async () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      const dto = testUser({ accessToken: 'fresh' });
      httpClient.post.mockReturnValue(of(dto));

      await authApi.restoreSession();

      expect(authApi.user()).toEqual(dto);
      expect(authApi.role()).toBe('ROLE_USER');

      const [url, , options] = httpClient.post.mock.calls[0] as [
        string,
        unknown,
        { context: HttpRequest<unknown>['context'] },
      ];
      expect(url).toMatch(/auth\/refresh$/);
      expect(options.context.get(SKIP_ERROR_TOAST)).toBe(true);
    });

    it('a refused renewal is swallowed and clears the state', async () => {
      // Startup must never throw: the page behind it may be perfectly public.
      localStorage.setItem(SESSION_HINT_KEY, '1');
      authApi.user.set(testUser());
      // A real 401, not a stand-in Error: only that status means "no session".
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      await expect(authApi.restoreSession()).resolves.toBeUndefined();

      expect(authApi.user()).toBeNull();
      expect(authApi.role()).toBeNull();
      expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('an unreachable server leaves the session alone', async () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

      await authApi.restoreSession();

      expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
    });
  });

  describe('activity keeps the session alive', () => {
    /** Logs in with a session window of `windowSeconds`, the number the server reports. */
    async function loggedInFor(windowSeconds: number): Promise<void> {
      // Fake timers AFTER the service exists, or its constructor would record its own start time
      // against a frozen clock.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      localStorage.setItem(SESSION_HINT_KEY, '1');
      httpClient.post.mockReturnValue(of(testUser({ expiresInSeconds: windowSeconds })));
      await authApi.restoreSession();
      httpClient.post.mockClear();
    }

    // Someone fills in a long form, the page makes no requests at all, and without this the
    // session idles out under someone who is plainly there.
    it.each([
      ['typing', () => new KeyboardEvent('keydown', { key: 'a' })],
      ['a wheel event', () => new WheelEvent('wheel')],
      ['a touchstart', () => new Event('touchstart')],
    ])('%s renews once the session is past half its window', async (_, event) => {
      await loggedInFor(1800);
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);

      document.dispatchEvent(event());

      expect(httpClient.post).toHaveBeenCalledOnce();
    });

    it('does not renew on every keystroke', async () => {
      await loggedInFor(1800);

      for (let i = 0; i < 20; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      }

      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('scales with the window the server reports, so no lifetime is duplicated here', async () => {
      await loggedInFor(180);
      vi.setSystemTime(Date.now() + 91 * 1000);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(httpClient.post).toHaveBeenCalledOnce();
    });

    it('a failed renewal is not retried by every following event', async () => {
      await loggedInFor(1800);
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      vi.setSystemTime(Date.now() + 16 * 60 * 1000);

      document.dispatchEvent(new WheelEvent('wheel'));
      // Let the rejection settle, or the events below would be swallowed by the in-flight
      // deduplication and this would pass without a throttle at all.
      await vi.advanceTimersByTimeAsync(0);

      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new WheelEvent('wheel'));
      }

      expect(httpClient.post).toHaveBeenCalledOnce();
    });

    it('stays quiet for a visitor who is not logged in', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      document.dispatchEvent(new MouseEvent('click'));
      document.dispatchEvent(new WheelEvent('wheel'));

      expect(httpClient.post).not.toHaveBeenCalled();
    });
  });

  describe('renewInUse', () => {
    it('collapses concurrent renewals into exactly one request', async () => {
      // Five requests failing at once must renew once, not five times - otherwise a burst of 401s
      // turns into a burst of /refresh calls, each rotating past the last.
      const subject = new Subject<UserWithTokenDto>();
      httpClient.post.mockReturnValue(subject.asObservable());

      const p1 = authApi.renewInUse();
      const p2 = authApi.renewInUse();

      expect(httpClient.post).toHaveBeenCalledTimes(1);

      subject.next(testUser({ accessToken: 'fresh' }));
      subject.complete();

      expect(await p1).toBe('renewed');
      expect(await p2).toBe('renewed');
    });

    it('a renewal answered after the session ended does not put the user back', async () => {
      // The race is between the ANSWERS, not the starts: a renewal begun before a logout can land
      // after it, and applying it would revive user and token on a tab that is already signed out.
      const subject = new Subject<UserWithTokenDto>();
      httpClient.post.mockReturnValue(subject.asObservable());

      const inFlight = authApi.renewInUse();
      authApi.clearTokens();

      subject.next(testUser({ accessToken: 'fresh' }));
      subject.complete();

      expect(await inFlight).toBe('inconclusive');
      expect(authApi.user()).toBeNull();
      expect(authApi.role()).toBeNull();
      expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    });

    it('a renewal the server refuses ends the session and carries where the user was', async () => {
      router.url = '/billets/7/edit';
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      expect(await authApi.renewInUse()).toBe('over');

      expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'SESSION_EXPIRED');
      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: '/billets/7/edit' },
      });
    });

    it('carries the page the user was going to, not the one they were leaving', async () => {
      // A session that dies mid-navigation: router.url still names the route being LEFT.
      router.url = '/billets';
      router.currentNavigation.mockReturnValue({ finalUrl: { toString: () => '/account' } });
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      await authApi.renewInUse();

      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: '/account' },
      });
    });

    it('a refused renewal without a loaded user clears quietly', async () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      expect(await authApi.renewInUse()).toBe('over');

      expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('a renewal refused for a session that has since ended does not touch the new one', async () => {
      const stale = authApi.markSession();
      authApi.clearTokens();
      authApi.user.set(testUser({ id: 9 }));
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      expect(await authApi.renewInUse(stale)).toBe('inconclusive');

      expect(authApi.user()).not.toBeNull();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
    });

    it('five callers of one refused renewal end the session once, not five times', async () => {
      const subject = new Subject<never>();
      httpClient.post.mockReturnValue(subject.asObservable());
      authApi.user.set(testUser());

      const waiting = [1, 2, 3, 4, 5].map(() => authApi.renewInUse());
      subject.error(new HttpErrorResponse({ status: 401 }));
      await Promise.all(waiting);

      expect(messageStore.addMessage).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });
  });

  describe('a renewal belongs to the session it was started for', () => {
    it('a startup probe refused after someone signed in does not clear the new session', async () => {
      localStorage.setItem(SESSION_HINT_KEY, '1');
      const refresh = new Subject<never>();
      httpClient.post.mockReturnValue(refresh.asObservable());

      const probe = authApi.restoreSession();
      // Somebody signs in while the probe is on the wire. Going through clearTokens is what a
      // logout and a fresh login do: setting the signal alone would not name a new session.
      authApi.clearTokens();
      localStorage.setItem(SESSION_HINT_KEY, '1');
      authApi.user.set(testUser({ id: 9 }));

      refresh.error(new HttpErrorResponse({ status: 401 }));
      await probe;

      expect(authApi.user()).not.toBeNull();
      expect(localStorage.getItem(SESSION_HINT_KEY)).not.toBeNull();
    });

    it('a renewal started before the session ended is not handed to the next one', async () => {
      const first = new Subject<never>();
      httpClient.post.mockReturnValue(first.asObservable());
      const outgoing = authApi.renewInUse().catch(() => undefined);

      authApi.clearTokens();

      const second = new Subject<never>();
      httpClient.post.mockReturnValue(second.asObservable());
      const incoming = authApi.renewInUse().catch(() => undefined);

      first.error(new HttpErrorResponse({ status: 401 }));
      second.error(new HttpErrorResponse({ status: 401 }));
      await Promise.all([outgoing, incoming]);

      expect(httpClient.post).toHaveBeenCalledTimes(2);
    });

    it('a login abandons a renewal still on the wire for the previous session', async () => {
      const stale = new Subject<UserWithTokenDto>();
      httpClient.post.mockReturnValueOnce(stale.asObservable());
      const outgoing = authApi.renewInUse();

      httpClient.post.mockReturnValueOnce(of(testUser({ id: 2, accessToken: 'b' })));
      await authApi.login({ email: 'b@c.de', password: 'Secret123' });

      expect(await outgoing).toBe('inconclusive');
      stale.next(testUser({ id: 1, accessToken: 'a' }));
      expect(authApi.user()?.id).toBe(2);
    });
  });

  describe('a credential rotation', () => {
    const renewed = testUser({ accessToken: 'fresh' });

    it('renews before the call leaves, so the call carries a live token', async () => {
      authApi.user.set(testUser());
      const refresh = new Subject<UserWithTokenDto>();
      httpClient.post.mockReturnValue(refresh.asObservable());
      const call = vi.fn(async () => 'changed');

      const rotation = authApi.rotateCredential(call);
      await Promise.resolve();
      expect(call).not.toHaveBeenCalled();

      refresh.next(renewed);
      refresh.complete();

      expect(await rotation).toBe('changed');
      expect(call).toHaveBeenCalledOnce();
    });

    it('lets no renewal start while the call is out', async () => {
      // Both requests leave on ONE event: the activity renewal is a document-level click listener,
      // and the click that submits the password form is that click.
      authApi.user.set(testUser());
      httpClient.post.mockReturnValueOnce(of(renewed));
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));

      let duringRotation: string | undefined;
      await authApi.rotateCredential(async () => {
        duringRotation = await authApi.renewInUse();
      });

      expect(duringRotation).toBe('inconclusive');
      expect(httpClient.post).toHaveBeenCalledOnce();
      expect(authApi.user()).not.toBeNull();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
    });

    it('joins the renewal already on the wire instead of racing it', async () => {
      const inFlight = new Subject<UserWithTokenDto>();
      httpClient.post.mockReturnValue(inFlight.asObservable());
      authApi.user.set(testUser());
      const call = vi.fn(async () => undefined);

      const renewal = authApi.renewInUse();
      const rotation = authApi.rotateCredential(call);
      inFlight.next(renewed);
      inFlight.complete();
      await rotation;

      expect(await renewal).toBe('renewed');
      expect(httpClient.post).toHaveBeenCalledOnce();
      expect(call).toHaveBeenCalledOnce();
    });

    it('does not send the call for a session that is already over', async () => {
      // Without a token the call would come back as a 401 that errorInterceptor toasts as a wrong
      // password, right under "session expired".
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
      const call = vi.fn(async () => undefined);

      await expect(authApi.rotateCredential(call)).rejects.toThrow();

      expect(call).not.toHaveBeenCalled();
      expect(messageStore.addMessage).toHaveBeenCalledOnce();
      expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'SESSION_EXPIRED');
    });

    it('renews normally again once it is over', async () => {
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(of(renewed));
      await authApi.rotateCredential(async () => undefined);

      expect(await authApi.renewInUse()).toBe('renewed');
    });

    it('closes the window even when the call it wraps fails', async () => {
      authApi.user.set(testUser());
      httpClient.post.mockReturnValue(of(renewed));

      await expect(
        authApi.rotateCredential(() => Promise.reject(new Error('rejected'))),
      ).rejects.toThrow('rejected');

      httpClient.post.mockReturnValue(of(testUser({ accessToken: 'fresher' })));
      expect(await authApi.renewInUse()).toBe('renewed');
    });
  });

  describe('password reset', () => {
    it('forgotPassword posts the email and confirms without saying whether it exists', async () => {
      httpClient.post.mockReturnValue(of(null));

      await authApi.forgotPassword('a@b.de');

      expect(httpClient.post.mock.calls[0][0]).toMatch(/auth\/forgot-password$/);
      expect(httpClient.post.mock.calls[0][1]).toEqual({ email: 'a@b.de' });
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'PASSWORD_RESET_EMAIL_SENT');
    });

    it('resetPassword posts token and both passwords', async () => {
      httpClient.post.mockReturnValue(of(null));

      await authApi.resetPassword('tok', 'Secret123', 'Secret123');

      expect(httpClient.post.mock.calls[0][0]).toMatch(/auth\/reset-password$/);
      expect(httpClient.post.mock.calls[0][1]).toEqual({
        token: 'tok',
        newPassword: 'Secret123',
        confirmPassword: 'Secret123',
      });
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'PASSWORD_RESET_SUCCESS');
    });
  });
});
