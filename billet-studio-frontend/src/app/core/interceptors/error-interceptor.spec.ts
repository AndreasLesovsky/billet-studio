import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpContext,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { errorInterceptor } from './error-interceptor';
import { ANSWERED_INLINE, SKIP_ERROR_TOAST } from './http-context-tokens';
import { MessageStore } from '../stores/message-store';
import { createMockMessageStore, MockMessageStore } from '../../../test-helpers';

function makeRequest(opts: {
  withAuth: boolean;
  skipToast?: boolean;
  answeredInline?: string[];
}): HttpRequest<unknown> {
  const headers = opts.withAuth
    ? new HttpHeaders({ Authorization: 'Bearer t' })
    : new HttpHeaders();
  const context = new HttpContext();
  if (opts.skipToast) context.set(SKIP_ERROR_TOAST, true);
  if (opts.answeredInline) context.set(ANSWERED_INLINE, opts.answeredInline);
  return new HttpRequest('GET', '/api/x', null, { headers, context });
}

function failingWith(status: number, error: unknown = null): HttpHandlerFn {
  return () => throwError(() => new HttpErrorResponse({ status, error }));
}

describe('errorInterceptor', () => {
  let messageStore: MockMessageStore;

  function run(req: HttpRequest<unknown>, next: HttpHandlerFn): Promise<HttpEvent<unknown>> {
    return new Promise((resolve, reject) =>
      TestBed.runInInjectionContext(() => errorInterceptor(req, next)).subscribe({
        next: resolve,
        error: reject,
      }),
    );
  }

  beforeEach(() => {
    messageStore = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [{ provide: MessageStore, useValue: messageStore }],
    });
  });

  it('passes through successful responses untouched', async () => {
    const next: HttpHandlerFn = () => of({ type: 4 } as unknown as HttpEvent<unknown>);

    await expect(run(makeRequest({ withAuth: true }), next)).resolves.toEqual({ type: 4 });
    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('401 WITH Authorization: stays silent - refreshTokenInterceptor owns that case', async () => {
    // It either renewed and retried, so this never runs, or it ended the session with its own
    // SESSION_EXPIRED toast. A second toast here would double up on the same event.
    await expect(
      run(makeRequest({ withAuth: true }), failingWith(401, { errorCode: 'UNAUTHORIZED' })),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('401 without Authorization header (login failure): toasts the errorCode', async () => {
    // A wrong password is an answer, not a session problem - nothing can renew it away.
    await expect(
      run(makeRequest({ withAuth: false }), failingWith(401, { errorCode: 'UNAUTHORIZED' })),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'UNAUTHORIZED', 401);
  });

  it('other errors: toasts errorCode and status, then rethrows', async () => {
    await expect(
      run(makeRequest({ withAuth: true }), failingWith(409, { errorCode: 'BILLET_LIMIT_REACHED' })),
    ).rejects.toMatchObject({ status: 409 });

    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'BILLET_LIMIT_REACHED', 409);
  });

  it('SKIP_ERROR_TOAST: suppresses the toast but still propagates the error', async () => {
    await expect(
      run(makeRequest({ withAuth: false, skipToast: true }), failingWith(500, { errorCode: 'X' })),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('ANSWERED_INLINE: suppresses the toast ONLY for a listed code, still propagates', async () => {
    const req = makeRequest({ withAuth: true, answeredInline: ['BILLET_MODIFIED_ELSEWHERE'] });

    await expect(
      run(req, failingWith(409, { errorCode: 'BILLET_MODIFIED_ELSEWHERE' })),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('ANSWERED_INLINE: an UNLISTED code on the same request keeps toasting', async () => {
    const req = makeRequest({ withAuth: true, answeredInline: ['BILLET_MODIFIED_ELSEWHERE'] });

    await expect(
      run(req, failingWith(409, { errorCode: 'BILLET_LIMIT_REACHED' })),
    ).rejects.toBeInstanceOf(HttpErrorResponse);

    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'BILLET_LIMIT_REACHED', 409);
  });

  it.each([
    ['no body', null],
    ['a non-ApiError body', 'Bad Gateway'],
    ['an empty errorCode', { errorCode: '' }],
  ])('%s: falls back to UNKNOWN_ERROR', async (_case, body) => {
    await expect(
      run(makeRequest({ withAuth: false }), failingWith(502, body)),
    ).rejects.toBeTruthy();

    expect(messageStore.addMessage).toHaveBeenCalledWith('error', 'UNKNOWN_ERROR', 502);
  });

  it('status 0 (aborted on navigation/reload, network drop): no toast, still propagates', async () => {
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }));

    await expect(run(makeRequest({ withAuth: false }), next)).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );

    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });
});
