import type { CanActivateFn } from '@angular/router';
import { sessionOrLogin } from './session-check';

/**
 * Reads state, makes no request in the normal case: the session is restored once at startup and
 * renewed by refreshTokenInterceptor when a real call needs it.
 */
export const authGuard: CanActivateFn = (_route, state) => sessionOrLogin(state.url);
