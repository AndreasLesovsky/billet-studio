import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpContext,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';

import { refreshTokenInterceptor } from './refresh-token-interceptor';
import { RETRIED_AFTER_REFRESH } from './http-context-tokens';
import { AuthApi, RenewalOutcome } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { baseUrl } from '../environments/environment';

function unauthorized(): HttpErrorResponse {
  return new HttpErrorResponse({ status: 401, error: { errorCode: 'UNAUTHORIZED' } });
}

interface Ctx {
  /** The session AuthApi would hand out right now. Move it to simulate a logout or a new login. */
  mark: symbol;
  authApi: {
    renewInUse: ReturnType<typeof vi.fn>;
    markSession: ReturnType<typeof vi.fn>;
    endSession: ReturnType<typeof vi.fn>;
  };
  accessToken: { get: ReturnType<typeof vi.fn>; couldHaveSession: ReturnType<typeof vi.fn> };
}

function configure(
  opts: {
    couldHaveSession?: boolean;
    tokenAfterRefresh?: string | null;
    /** What the renewal reports for a caller whose session is still the current one. */
    outcome?: RenewalOutcome;
  } = {},
): Ctx {
  const ctx = { mark: Symbol('session') } as Ctx;

  ctx.authApi = {
    // A stand-in for the real classification: a caller that no longer belongs to the session in
    // front of the user learns nothing about it, whatever the server answered.
    renewInUse: vi.fn((mark: symbol) =>
      Promise.resolve<RenewalOutcome>(
        mark === ctx.mark ? (opts.outcome ?? 'renewed') : 'inconclusive',
      ),
    ),
    markSession: vi.fn(() => ctx.mark),
    endSession: vi.fn(),
  };
  ctx.accessToken = {
    get: vi.fn(() => (opts.tokenAfterRefresh === undefined ? 'fresh' : opts.tokenAfterRefresh)),
    couldHaveSession: vi.fn(() => opts.couldHaveSession ?? true),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthApi, useValue: ctx.authApi },
      { provide: AccessToken, useValue: ctx.accessToken },
    ],
  });
  return ctx;
}

function run(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  return TestBed.runInInjectionContext(() => refreshTokenInterceptor(req, next));
}

function settle(obs: Observable<HttpEvent<unknown>>): Promise<HttpEvent<unknown>> {
  return new Promise((resolve, reject) => obs.subscribe({ next: resolve, error: reject }));
}

const apiRequest = () => new HttpRequest('PUT', `${baseUrl}billets/7`, {});
const asHandler = (fn: unknown) => fn as HttpHandlerFn;

describe('refreshTokenInterceptor', () => {
  beforeEach(() => configure());

  it('renews and retries a 401, so the caller never sees it', async () => {
    const ctx = configure();
    const next = vi
      .fn()
      .mockReturnValueOnce(throwError(() => unauthorized()))
      .mockReturnValueOnce(of({ type: 4 } as unknown as HttpEvent<unknown>));

    const result = await settle(run(apiRequest(), asHandler(next)));

    expect(ctx.authApi.renewInUse).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ type: 4 });

    // The retry marker must stay off the wire: as a custom header it would not be CORS-safelisted,
    // the preflight would reject it, and the retry would come back as status 0.
    const retriedRequest = (next.mock.calls[1] as [HttpRequest<unknown>])[0];
    expect(retriedRequest.headers.keys()).toEqual(['Authorization']);
    expect(retriedRequest.headers.get('Authorization')).toBe('Bearer fresh');
    expect(retriedRequest.context.get(RETRIED_AFTER_REFRESH)).toBe(true);
  });

  it('retries exactly once: a second 401 propagates instead of looping', async () => {
    const ctx = configure();
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledTimes(2);
    expect(ctx.authApi.renewInUse).toHaveBeenCalledOnce();
  });

  it('a renewal that proves nothing leaves the original error as the answer', async () => {
    const ctx = configure({ outcome: 'inconclusive' });
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.authApi.endSession).not.toHaveBeenCalled();
  });

  it('a session the server has disowned is not retried under, and is not ended from here', async () => {
    // What 'over' MEANS is decided in AuthApi, once. This interceptor only stops resending.
    const ctx = configure({ outcome: 'over' });
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.authApi.endSession).not.toHaveBeenCalled();
  });

  it('no token after a renewal: the original error stands', async () => {
    configure({ tokenAfterRefresh: null });
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toMatchObject({ status: 401 });

    expect(next).toHaveBeenCalledOnce();
  });

  it('a domain error of the retried request belongs to the caller, not to the session', async () => {
    const ctx = configure();
    const next = vi
      .fn()
      .mockReturnValueOnce(throwError(() => unauthorized()))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toMatchObject({ status: 500 });

    expect(ctx.authApi.endSession).not.toHaveBeenCalled();
  });

  it('a rejected renewal never reaches the caller instead of its own error', async () => {
    // endSession runs component code through UnsavedWork.keepAll, so renewInUse can throw. The
    // original request must still answer with the error it actually got.
    const ctx = configure();
    ctx.authApi.renewInUse = vi.fn(() => Promise.reject(new Error('keepAll blew up')));
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('leaves the auth handshake alone, or a failing refresh would trigger a refresh', async () => {
    const ctx = configure();
    const next = vi.fn(() => throwError(() => unauthorized()));
    const login = new HttpRequest('POST', `${baseUrl}auth/login`, {});

    await expect(settle(run(login, asHandler(next)))).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(ctx.authApi.renewInUse).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not renew for a visitor who never had a session', async () => {
    const ctx = configure({ couldHaveSession: false });
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(ctx.authApi.renewInUse).not.toHaveBeenCalled();
  });

  it('leaves a 403 alone: fresh credentials would be refused the same way', async () => {
    const ctx = configure();
    const next = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403 })));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(ctx.authApi.renewInUse).not.toHaveBeenCalled();
  });

  it('an already-retried request is not retried again', async () => {
    const ctx = configure();
    const next = vi.fn(() => throwError(() => unauthorized()));
    const retried = new HttpRequest(
      'PUT',
      `${baseUrl}billets/7`,
      {},
      {
        context: new HttpContext().set(RETRIED_AFTER_REFRESH, true),
      },
    );

    await expect(settle(run(retried, asHandler(next)))).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(ctx.authApi.renewInUse).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('a request sent under the previous account is not retried under the current one', async () => {
    // The session changes while the ORIGINAL request is on the wire. Reading the session only once
    // the renewal starts would describe whoever is signed in by then, and A's payload would go out
    // under B's token.
    const ctx = configure();
    const next = vi.fn(() => {
      ctx.mark = Symbol('the next account');
      return throwError(() => unauthorized());
    });

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.authApi.markSession.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0],
    );
  });

  it('a request whose session ended mid-renewal is not retried under the next account', async () => {
    const ctx = configure();
    ctx.authApi.renewInUse = vi.fn(() => {
      ctx.mark = Symbol('the next account');
      return Promise.resolve<RenewalOutcome>('inconclusive');
    });
    const next = vi.fn(() => throwError(() => unauthorized()));

    await expect(settle(run(apiRequest(), asHandler(next)))).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.authApi.endSession).not.toHaveBeenCalled();
  });
});
