import { HttpContextToken } from '@angular/common/http';

// Own file, not next to errorInterceptor: services import these, and a service importing from an
// interceptor that injects AuthApi would close a cycle (auth-api -> interceptor -> auth-api).

/** Suppress the automatic error toast for this request. */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

/** errorCodes this request answers itself in the UI; every other code still toasts. */
export const ANSWERED_INLINE = new HttpContextToken<string[]>(() => []);

/**
 * Keeps this request away from the global spinner, for a request whose own indicator is already on
 * screen (the editor's save status during autosave). Set inside a core `*-api.ts` method that exists
 * for exactly that request, never by a component - loadingInterceptor stays the one place that
 * decides, and this is one of its inputs.
 */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

/**
 * Marks the one retry refreshTokenInterceptor allows. A context, never a header: a custom header is
 * not CORS-safelisted and the backend's allowed headers do not list it, so the retry would be
 * blocked before leaving and come back as status 0 - which reads here as a dead session.
 */
export const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

/**
 * The session handshake, authorised by the refresh cookie or by credentials - never by the
 * Authorization header. authTokenInterceptor must not attach the token here: /refresh exists
 * precisely for the moment the access token is dead, and a JWT filter that sees an expired one
 * would 401 the very call that replaces it. refreshTokenInterceptor also never retries these: a 401
 * from the handshake is the answer. Mirrors the backend's JWT filter exemption for
 * /v1/auth/login|refresh|logout.
 */
const AUTH_HANDSHAKE_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'] as const;

export function isAuthHandshake(url: string): boolean {
  return AUTH_HANDSHAKE_ENDPOINTS.some((path) => url.includes(path));
}

/**
 * Endpoints whose RESPONSE may carry a Set-Cookie for the refresh token. App and API are different
 * origins, so the browser discards that cookie unless the request was sent with credentials, and a
 * call site that forgets loses the session silently - it looks like a working request and the user
 * is signed out on the next reload.
 *
 * A different question from {@link isAuthHandshake}, which is about which credential AUTHORISES a
 * request. These overlap by accident, not by rule.
 *
 * `/users/` is the admin editor. Only an admin changing their OWN password gets a cookie back, and
 * the URL cannot say so in advance; sending credentials on the others costs nothing.
 */
const SESSION_COOKIE_ENDPOINTS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/account/change-password',
  '/users/',
] as const;

export function carriesSessionCookie(url: string): boolean {
  return SESSION_COOKIE_ENDPOINTS.some((path) => url.includes(path));
}
