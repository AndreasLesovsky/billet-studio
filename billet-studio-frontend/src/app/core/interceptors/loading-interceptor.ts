import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { signal } from '@angular/core';
import { finalize } from 'rxjs';
import { SKIP_LOADING } from './http-context-tokens';

/** The global spinner's state. Read by the spinner component; written only by this interceptor. */
export const isLoading = signal(false);

const SHOW_DELAY = 250; // ms before the spinner appears
const MIN_DURATION = 400; // ms minimum visible time once the spinner is shown

let activeRequests = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let spinnerVisibleSince: number | null = null;

/**
 * Which requests never drive the global spinner. The rules live HERE, not as a flag a component
 * sets, so a new request in one of these areas inherits the right behaviour by itself.
 *
 * - SKIP_LOADING: a request whose own indicator is on screen (see the token).
 * - `/auth/refresh`: the renewal runs in the background (activity, the session clock). A request
 *   that waits on it through refreshTokenInterceptor keeps the spinner going on its own, so nothing
 *   the user asked for goes without one.
 */
function hasOwnLoadingUi(req: HttpRequest<unknown>): boolean {
  return req.context.get(SKIP_LOADING) || req.url.endsWith('/auth/refresh');
}

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (hasOwnLoadingUi(req)) {
    return next(req);
  }
  activeRequests++;

  if (activeRequests === 1) {
    clearTimeout(hideTimer ?? undefined);
    showTimer = setTimeout(() => {
      isLoading.set(true);
      spinnerVisibleSince = Date.now();
    }, SHOW_DELAY);
  }

  return next(req).pipe(
    finalize(() => {
      activeRequests = Math.max(0, activeRequests - 1);
      if (activeRequests > 0) return;

      clearTimeout(showTimer ?? undefined);
      if (spinnerVisibleSince === null) {
        // The request finished before SHOW_DELAY: the spinner never became visible.
        isLoading.set(false);
        return;
      }
      const remaining = Math.max(MIN_DURATION - (Date.now() - spinnerVisibleSince), 0);
      hideTimer = setTimeout(() => {
        isLoading.set(false);
        spinnerVisibleSince = null;
      }, remaining);
    }),
  );
};
