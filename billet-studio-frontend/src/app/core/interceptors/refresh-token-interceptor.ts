import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { AuthApi } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { RETRIED_AFTER_REFRESH, isAuthHandshake } from './http-context-tokens';

/**
 * Turns an expired access token into a renewed one without the user noticing: a request that comes
 * back 401 is renewed against the refresh cookie and sent again, so the page never moves and the
 * work on it is not lost.
 *
 * Three rules keep it from eating itself: the auth endpoints are exempt (a failing refresh must not
 * trigger a refresh), the retry happens exactly once, and concurrent 401s share ONE renewal because
 * AuthApi collapses them.
 */
export const refreshTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const authApi = inject(AuthApi);
  const accessToken = inject(AccessToken);

  // Taken where the request goes OUT, not where its 401 comes back. A logout and a new login can
  // both land in between, and reading the session only at that point describes whoever is signed in
  // by then - one account's payload would be resent under another's token.
  const mark = authApi.markSession();

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (!shouldTryRefresh(error, req, accessToken)) {
        return throwError(() => error);
      }
      return refreshThenRetry(req, next, authApi, accessToken, mark, error);
    }),
  );
};

function shouldTryRefresh(
  error: HttpErrorResponse,
  req: HttpRequest<unknown>,
  accessToken: AccessToken,
): boolean {
  // 401 only. A 403 means the credentials were understood and are not enough, so a fresh token
  // produces the same answer.
  if (error.status !== 401) return false;
  // A 401 from the handshake itself is the answer, not a reason to retry.
  if (isAuthHandshake(req.url)) return false;
  if (req.context.get(RETRIED_AFTER_REFRESH)) return false;
  // Nothing to renew: an anonymous visitor hitting a protected endpoint is simply not logged in.
  return accessToken.couldHaveSession();
}

function refreshThenRetry(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authApi: AuthApi,
  accessToken: AccessToken,
  mark: symbol,
  original: HttpErrorResponse,
): Observable<HttpEvent<unknown>> {
  return from(authApi.renewInUse(mark)).pipe(
    // What a dead session MEANS is decided in AuthApi, once. What reaches here is only whether this
    // request may go again. A failure of the renewal itself is not this request's answer; catching
    // AFTER the retry instead would end the session on any domain error of the retried request.
    catchError(() => throwError(() => original)),
    switchMap((outcome) => {
      if (outcome !== 'renewed') return throwError(() => original);
      const token = accessToken.get();
      if (!token) return throwError(() => original);
      // authTokenInterceptor already ran for this request, so the fresh token is set here. The
      // retry's own failures flow to the caller untouched: they belong to the request, not to the
      // session.
      return next(
        req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
          context: req.context.set(RETRIED_AFTER_REFRESH, true),
        }),
      );
    }),
  );
}
