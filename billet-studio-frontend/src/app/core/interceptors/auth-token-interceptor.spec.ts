import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpEvent, HttpHandlerFn, HttpHeaders, HttpRequest } from '@angular/common/http';
import { of } from 'rxjs';

import { authTokenInterceptor } from './auth-token-interceptor';
import { AccessToken } from '../services/access-token';
import { baseUrl } from '../environments/environment';
import { createMockAccessToken } from '../../../test-helpers';

/**
 * Capture the (possibly cloned) request the interceptor forwards to next(). next() returns a
 * synchronous of(), so the captured request is set by the time this returns.
 */
function capture(req: HttpRequest<unknown>): HttpRequest<unknown> {
  let forwarded = req;
  const next: HttpHandlerFn = (r) => {
    forwarded = r;
    return of({ type: 4 } as unknown as HttpEvent<unknown>);
  };
  TestBed.runInInjectionContext(() => authTokenInterceptor(req, next)).subscribe();
  return forwarded;
}

/** The interceptor must pass the original request straight through, unmodified. */
function expectUntouched(req: HttpRequest<unknown>): void {
  const forwarded = capture(req);
  expect(forwarded.headers.has('Authorization')).toBe(false);
  expect(forwarded).toBe(req);
}

function provideToken(token: string | null): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: AccessToken, useValue: createMockAccessToken({ token }) }],
  });
}

describe('authTokenInterceptor', () => {
  beforeEach(() => provideToken(null));

  it('attaches the Bearer token to API requests when logged in', () => {
    provideToken('jwt-123');
    const req = new HttpRequest('GET', `${baseUrl}billets`, null);

    const forwarded = capture(req);

    expect(forwarded.headers.get('Authorization')).toBe('Bearer jwt-123');
  });

  it('does NOT attach a token for guests and forwards the request unchanged', () => {
    expectUntouched(new HttpRequest('GET', `${baseUrl}billets`, null));
  });

  it('leaves non-API URLs (i18n/assets/external) untouched even when logged in', () => {
    provideToken('jwt-123');
    expectUntouched(new HttpRequest('GET', 'i18n/de.json', null));
  });

  it('does not send the token to the session handshake, which the cookie authorises', () => {
    // An expired token riding along on /auth/refresh would get the very call that replaces it
    // rejected by the JWT filter.
    provideToken('jwt-123');
    for (const path of ['auth/login', 'auth/refresh', 'auth/logout']) {
      expectUntouched(new HttpRequest('POST', `${baseUrl}${path}`, {}));
    }
  });

  it('never overrides an Authorization header a caller already set', () => {
    // refreshTokenInterceptor sets it by hand on its one retry, and that fresh token must win.
    provideToken('jwt-123');
    const req = new HttpRequest('GET', `${baseUrl}billets`, null, {
      headers: new HttpHeaders({ Authorization: 'Bearer caller-set' }),
    });

    const forwarded = capture(req);

    expect(forwarded.headers.get('Authorization')).toBe('Bearer caller-set');
  });
});
