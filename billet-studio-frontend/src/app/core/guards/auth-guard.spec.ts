import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { authGuard } from './auth-guard';
import { AuthApi } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { MessageStore } from '../stores/message-store';
import {
  createMockAccessToken,
  createMockAuthApi,
  createMockMessageStore,
  createMockRouter,
} from '../../../test-helpers';

function runGuard(stateUrl: string): Promise<boolean | UrlTree> {
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: stateUrl } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() => Promise.resolve(authGuard(route, state))) as Promise<
    boolean | UrlTree
  >;
}

describe('authGuard', () => {
  let authApi: ReturnType<typeof createMockAuthApi>;
  let router: ReturnType<typeof createMockRouter>;
  let messageStore: ReturnType<typeof createMockMessageStore>;

  function configure(opts: { loggedIn?: boolean; couldHaveSession?: boolean } = {}): void {
    TestBed.resetTestingModule();
    authApi = createMockAuthApi({ loggedIn: opts.loggedIn });
    router = createMockRouter();
    messageStore = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApi, useValue: authApi },
        {
          provide: AccessToken,
          useValue: createMockAccessToken({ couldHaveSession: opts.couldHaveSession ?? false }),
        },
        { provide: Router, useValue: router },
        { provide: MessageStore, useValue: messageStore },
      ],
    });
  }

  beforeEach(() => configure());

  it('logged in: passes without asking the server', async () => {
    configure({ loggedIn: true });

    const result = await runGuard('/billets');

    expect(result).toBe(true);
    // Navigation does not wait on a round trip.
    expect(authApi.restoreSession).not.toHaveBeenCalled();
    expect(router.createUrlTree).not.toHaveBeenCalled();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('session hint but no user: tries once to restore, then passes', async () => {
    configure({ loggedIn: false, couldHaveSession: true });
    authApi.restoreSession.mockImplementation(async () => {
      authApi.isLoggedIn.set(true);
    });

    const result = await runGuard('/billets');

    expect(authApi.restoreSession).toHaveBeenCalledOnce();
    expect(result).toBe(true);
    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('session hint but restore fails: SESSION_EXPIRED toast + login with returnUrl', async () => {
    configure({ loggedIn: false, couldHaveSession: true });

    await runGuard('/billets');

    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'SESSION_EXPIRED');
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/billets' },
    });
  });

  it('guest without a hint: login with returnUrl, NO toast and no request', async () => {
    configure({ loggedIn: false, couldHaveSession: false });

    const result = await runGuard('/account');

    expect(authApi.restoreSession).not.toHaveBeenCalled();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/account' },
    });
    expect(String(result)).toBe('urltree:/login');
  });

  it('uses state.url verbatim as returnUrl (including query string)', async () => {
    configure({ loggedIn: false, couldHaveSession: false });

    await runGuard('/billets/new?template=muttertag');

    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/billets/new?template=muttertag' },
    });
  });
});
