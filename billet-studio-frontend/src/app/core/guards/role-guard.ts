import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { AuthApi } from '../services/auth-api';
import { sessionOrLogin } from './session-check';

/** authGuard's question plus a role. The server enforces the role anyway; this only saves the trip. */
export const requireRole = (requiredRole: string): CanActivateFn => {
  return async (_route, state): Promise<boolean | UrlTree> => {
    const auth = inject(AuthApi);
    const router = inject(Router);

    const session = await sessionOrLogin(state.url);
    if (session !== true) return session;

    if (auth.role() === requiredRole) return true;
    // Authenticated but wrong role: home page, no returnUrl, no toast.
    return router.createUrlTree(['/']);
  };
};
