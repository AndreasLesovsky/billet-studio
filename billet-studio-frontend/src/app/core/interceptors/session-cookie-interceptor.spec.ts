import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { of } from 'rxjs';

import { sessionCookieInterceptor } from './session-cookie-interceptor';
import { baseUrl } from '../environments/environment';

/** Returns the request as it left the interceptor. */
function sent(req: HttpRequest<unknown>): HttpRequest<unknown> {
  const next = vi.fn((_r: HttpRequest<unknown>) =>
    of({ type: 4 } as unknown as HttpEvent<unknown>),
  );
  TestBed.runInInjectionContext(() =>
    sessionCookieInterceptor(req, next as unknown as HttpHandlerFn),
  ).subscribe();
  return next.mock.calls[0][0];
}

describe('sessionCookieInterceptor', () => {
  // Every endpoint whose answer can replace the refresh cookie. A missing one is invisible in the
  // browser: the call succeeds, the Set-Cookie is dropped because app and API are different
  // origins, and the session is gone at the next reload.
  it.each([
    ['login', 'POST', 'auth/login'],
    ['renewal', 'POST', 'auth/refresh'],
    ['logout', 'POST', 'auth/logout'],
    ['a user changing their password', 'POST', 'account/change-password'],
    ['an admin editing a user, possibly themselves', 'PUT', 'users/7'],
  ])('sends credentials for %s', (_case, method, path) => {
    const req = new HttpRequest(method as 'POST', `${baseUrl}${path}`, {});

    expect(sent(req).withCredentials).toBe(true);
  });

  it('leaves every other API call uncredentialed', () => {
    for (const path of ['account', 'account/deactivate', 'users', 'auth/register', 'billets/3']) {
      const req = new HttpRequest('GET', `${baseUrl}${path}`);

      expect(sent(req).withCredentials).toBe(false);
    }
  });

  it('leaves non-API URLs alone, so i18n and assets carry nothing', () => {
    const req = new HttpRequest('GET', 'i18n/de.json');

    expect(sent(req).withCredentials).toBe(false);
  });
});
