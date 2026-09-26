import { HttpErrorResponse } from '@angular/common/http';

import type { ApiError } from '../models/models';

/** The `errorCode` of an HTTP error that carried an ApiError body; null for anything else. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null) return null;
  const code: unknown = (body as Partial<ApiError>).errorCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * The request got no answer at all (status 0): offline, the server down, or aborted. errorInterceptor
 * leaves it unsaid, so an action the user started has to say it failed.
 */
export function isUnreachable(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 0;
}
