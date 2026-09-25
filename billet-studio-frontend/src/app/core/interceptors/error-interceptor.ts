import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import type { ApiError } from '../models/models';
import { MessageStore } from '../stores/message-store';
import { ANSWERED_INLINE, SKIP_ERROR_TOAST } from './http-context-tokens';

/** errorCode of a response that carried no ApiError body. */
const UNKNOWN_ERROR = 'UNKNOWN_ERROR';

/**
 * The one place an HTTP error becomes a toast: MESSAGES.ERROR.<errorCode>. Services rethrow and
 * never toast an error themselves; components catch only when they must react.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const messageStore = inject(MessageStore);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const code = errorCodeOf(error);

      // A 401 on a request that carried a token is a session problem, and refreshTokenInterceptor
      // has already had its go: it either renewed and retried (this never runs) or ended the session
      // with its own toast. Saying it twice would be worse than not saying it.
      //
      // A 401 WITHOUT a token is an answer, not a session problem - a wrong password on login - and
      // that one has to be toasted like any other error.
      if (error.status === 401 && req.headers.has('Authorization')) {
        return throwError(() => error);
      }

      // status 0 = the request never completed: aborted on navigation/page reload, or a network/CORS
      // drop. Not a server answer to surface.
      if (error.status === 0) {
        return throwError(() => error);
      }

      if (!req.context.get(SKIP_ERROR_TOAST) && !req.context.get(ANSWERED_INLINE).includes(code)) {
        messageStore.addMessage('error', code, error.status);
      }
      return throwError(() => error);
    }),
  );
};

function errorCodeOf(error: HttpErrorResponse): string {
  const body: unknown = error.error;
  if (typeof body === 'object' && body !== null) {
    const code: unknown = (body as Partial<ApiError>).errorCode;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return UNKNOWN_ERROR;
}
