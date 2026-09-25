import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpContext, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Subject } from 'rxjs';

import { isLoading, loadingInterceptor } from './loading-interceptor';
import { SKIP_LOADING } from './http-context-tokens';

/**
 * The global progress bar is driven by the interceptor alone. Its timing (a show delay against
 * flicker, a minimum visible time once shown) and the requests it leaves alone are pinned here.
 */
describe('loadingInterceptor', () => {
  function fire(requestUrl: string, context = new HttpContext()) {
    const response = new Subject<HttpResponse<unknown>>();
    const next: HttpHandlerFn = () => response;
    const req = new HttpRequest('POST', requestUrl, {}, { context });
    const sub = TestBed.runInInjectionContext(() => loadingInterceptor(req, next)).subscribe();

    return {
      finish: () => {
        response.complete();
        sub.unsubscribe();
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(isLoading()).toBe(false); // no test may leak a running bar into the next one
  });

  it('a normal request drives the global bar after the show delay of 300 ms', () => {
    const req = fire('https://api.example.com/v1/billets/7');

    vi.advanceTimersByTime(299);
    expect(isLoading()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isLoading()).toBe(true);
    req.finish();
  });

  it('a request that finishes before the delay never shows it', () => {
    const req = fire('https://api.example.com/v1/billets/7');
    vi.advanceTimersByTime(290);
    req.finish();

    vi.advanceTimersByTime(500);
    expect(isLoading()).toBe(false);
  });

  it('once shown, it stays for 400 ms so it does not flash', () => {
    const req = fire('https://api.example.com/v1/billets/7');
    vi.advanceTimersByTime(300);
    req.finish();

    vi.advanceTimersByTime(399);
    expect(isLoading()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isLoading()).toBe(false);
  });

  it('overlapping requests share one bar, which waits for the last of them', () => {
    const first = fire('https://api.example.com/v1/billets');
    const second = fire('https://api.example.com/v1/models');
    vi.advanceTimersByTime(300);

    first.finish();
    vi.advanceTimersByTime(1000);
    expect(isLoading()).toBe(true);

    second.finish();
  });

  it('SKIP_LOADING: a request with its own indicator never shows the global one', () => {
    const req = fire(
      'https://api.example.com/v1/billets/7',
      new HttpContext().set(SKIP_LOADING, true),
    );
    vi.advanceTimersByTime(300);

    expect(isLoading()).toBe(false);
    req.finish();
  });

  it('the background session renewal never shows it', () => {
    const req = fire('https://api.example.com/v1/auth/refresh');
    vi.advanceTimersByTime(300);

    expect(isLoading()).toBe(false);
    req.finish();
  });
});
