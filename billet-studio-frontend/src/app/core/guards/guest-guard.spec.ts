import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { guestGuard } from './guest-guard';
import { AuthApi } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { createMockAccessToken, createMockAuthApi, createMockRouter } from '../../../test-helpers';

/** A signed-in user is covered by the route test in app.spec.ts; these are the restore branches. */
function setup(opts: { couldHaveSession: boolean; restores: boolean }) {
  const authApi = createMockAuthApi({ loggedIn: false });
  authApi.restoreSession.mockImplementation(async () => {
    if (opts.restores) authApi.isLoggedIn.set(true);
  });
  const router = createMockRouter();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthApi, useValue: authApi },
      {
        provide: AccessToken,
        useValue: createMockAccessToken({ couldHaveSession: opts.couldHaveSession }),
      },
      { provide: Router, useValue: router },
    ],
  });
  const run = () =>
    TestBed.runInInjectionContext(() =>
      Promise.resolve(guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)),
    ) as Promise<boolean | UrlTree>;
  return { router, run };
}

describe('guestGuard', () => {
  it('a session the hint restores counts as signed in', async () => {
    const { router, run } = setup({ couldHaveSession: true, restores: true });

    expect(String(await run())).toBe('urltree:/billets');
    expect(router.createUrlTree).toHaveBeenCalledWith(['/billets']);
  });

  it.each([
    ['a guest', { couldHaveSession: false, restores: false }],
    ['an expired session', { couldHaveSession: true, restores: false }],
  ])('%s opens the page, so a reset link stays usable', async (_, opts) => {
    const { router, run } = setup(opts);

    expect(await run()).toBe(true);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });
});
