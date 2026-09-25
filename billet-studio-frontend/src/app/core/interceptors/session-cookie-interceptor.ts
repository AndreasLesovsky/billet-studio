import { HttpInterceptorFn } from '@angular/common/http';
import { baseUrl } from '../environments/environment';
import { carriesSessionCookie } from './http-context-tokens';

/**
 * Sends credentials on the calls whose answer may replace the refresh cookie, so no call site has
 * to remember. Held here rather than at each `http.post(...)` because forgetting it is invisible:
 * the request succeeds, the browser drops the Set-Cookie, and the session dies at the next reload.
 *
 * It injects nothing, so it cannot reach LanguageService and the interceptor deadlock rule around
 * AuthApi is unaffected.
 */
export const sessionCookieInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith(baseUrl) && carriesSessionCookie(req.url)) {
    req = req.clone({ withCredentials: true });
  }
  return next(req);
};
