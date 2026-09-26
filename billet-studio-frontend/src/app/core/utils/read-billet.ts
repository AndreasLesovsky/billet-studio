import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, type Observable } from 'rxjs';

import type { BilletDocument } from '../../billet/billet-document';
import { migrateDocument } from '../../billet/migrate-document';

/** A response carrying a billet document, with the document migrated; null when it is unreadable. */
export function withReadableDocument<T extends { document: BilletDocument }>(
  response: T,
): T | null {
  const document = migrateDocument(response.document);
  return document ? { ...response, document } : null;
}

/**
 * A billet read from the API: null when there is none (404) or its document cannot be read; any
 * other failure is thrown.
 */
export async function readBillet<T extends { document: BilletDocument }>(
  request: Observable<T>,
): Promise<T | null> {
  let response: T;
  try {
    response = await firstValueFrom(request);
  } catch (error) {
    if (error instanceof HttpErrorResponse && error.status === 404) return null;
    throw error;
  }
  return withReadableDocument(response);
}
