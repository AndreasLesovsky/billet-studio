import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AccessToken } from '../services/access-token';
import { AuthApi, POST_LOGIN_ROUTE } from '../services/auth-api';
import { hasSession } from './session-check';

/**
 * The sign-in, sign-up and password pages are for guests: someone signed in lands on their billets.
 * Everyone else passes, so a reset link keeps working for a signed-out visitor.
 */
export const guestGuard: CanActivateFn = async (): Promise<true | UrlTree> => {
  const auth = inject(AuthApi);
  const accessToken = inject(AccessToken);
  const router = inject(Router);

  return (await hasSession(auth, accessToken)) ? router.createUrlTree([POST_LOGIN_ROUTE]) : true;
};
