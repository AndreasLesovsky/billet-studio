import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { requireRole } from './role-guard';
import { AuthApi } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { MessageStore } from '../stores/message-store';
import {
  createMockAccessToken,
  createMockAuthApi,
  createMockMessageStore,
  createMockRouter,
} from '../../../test-helpers';

function runGuard(requiredRole: string, stateUrl: string): Promise<boolean | UrlTree> {
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: stateUrl } as RouterStateSnapshot;
  const fn = requireRole(requiredRole);
  return TestBed.runInInjectionContext(() => Promise.resolve(fn(route, state))) as Promise<
    boolean | UrlTree
  >;
}

describe('requireRole', () => {
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

  it('returns true when authenticated and the role matches', async () => {
    configure({ loggedIn: true });
    authApi.role.set('ROLE_ADMIN');

    const result = await runGuard('ROLE_ADMIN', '/admin/users');

    expect(result).toBe(true);
    expect(authApi.restoreSession).not.toHaveBeenCalled();
    expect(router.createUrlTree).not.toHaveBeenCalled();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('authenticated but wrong role: UrlTree(/) - no toast, no returnUrl', async () => {
    configure({ loggedIn: true });
    authApi.role.set('ROLE_USER');

    await runGuard('ROLE_ADMIN', '/admin/users');

    expect(messageStore.addMessage).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
  });

  it('session hint but restore fails: UrlTree(/login) with returnUrl + SESSION_EXPIRED', async () => {
    configure({ loggedIn: false, couldHaveSession: true });

    await runGuard('ROLE_ADMIN', '/admin/users');

    expect(authApi.restoreSession).toHaveBeenCalledOnce();
    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'SESSION_EXPIRED');
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin/users' },
    });
  });

  it('guest without a hint: UrlTree(/login) with returnUrl, NO toast and no request', async () => {
    configure({ loggedIn: false, couldHaveSession: false });

    await runGuard('ROLE_ADMIN', '/admin/users');

    expect(authApi.restoreSession).not.toHaveBeenCalled();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/admin/users' },
    });
  });
});
