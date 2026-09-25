import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { baseUrl } from '../environments/environment';
import { AccessToken } from '../services/access-token';
import { isAuthHandshake } from './http-context-tokens';

/**
 * Attaches the access token to API requests. Scoped to the API base, never overrides a header a
 * caller already set, and never sent to the session handshake - see AUTH_HANDSHAKE_ENDPOINTS for
 * why an expired token there would kill its own replacement.
 *
 * Injects AccessToken and nothing else, which has no dependencies of its own - so this cannot reach
 * AuthApi, whose tree must never touch LanguageService/TranslateService (their constructor fires an
 * HTTP request that comes back through this chain and deadlocks the app).
 */
export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AccessToken).get();
  if (
    token &&
    req.url.startsWith(baseUrl) &&
    !isAuthHandshake(req.url) &&
    !req.headers.has('Authorization')
  ) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
