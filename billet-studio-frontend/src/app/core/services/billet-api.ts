import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import type { BilletDocument } from '../../billet/billet-document';
import { baseUrl } from '../environments/environment';
import {
  ANSWERED_INLINE,
  SKIP_ERROR_TOAST,
  SKIP_LOADING,
} from '../interceptors/http-context-tokens';
import {
  BilletCreateRequest,
  BilletDetailDto,
  BilletImportRequest,
  BilletImportResponse,
  BilletSaveRequest,
  BilletSaveResponse,
  BilletSummaryDto,
  PublishRequest,
  PublishResponse,
} from '../models/models';
import { MessageStore } from '../stores/message-store';
import { apiErrorCode } from '../utils/api-error';
import { readBillet, withReadableDocument } from '../utils/read-billet';

/**
 * The errorCodes a request leaves to its caller. A context per request: interceptors write into
 * the one they are given (refreshTokenInterceptor marks its retry there).
 */
const answeredInline = (...codes: string[]) => new HttpContext().set(ANSWERED_INLINE, codes);

/**
 * Billets one account holds: the default of the backend's `app.billet.max-per-user`, which stays
 * the authority (BILLET_LIMIT_REACHED). The list uses it to say how much room is left.
 */
export const MAX_ACCOUNT_BILLETS = 50;

/** Documents one import request may carry (BilletImportRequest). */
export const MAX_IMPORT_DOCUMENTS = 20;

/**
 * The signed-in user's billets, `/v1/billets`. Errors propagate unchanged: errorInterceptor has
 * already shown the toast, except for the codes a method names as answered by its caller. Every
 * document that arrives passes migrateDocument().
 */
@Injectable({ providedIn: 'root' })
export class BilletApi {
  private readonly http = inject(HttpClient);
  private readonly messageStore = inject(MessageStore);
  private readonly api = `${baseUrl}billets`;

  /** Newest edit first. */
  list(): Promise<BilletSummaryDto[]> {
    return firstValueFrom(this.http.get<BilletSummaryDto[]>(this.api));
  }

  /** The caller answers 409 BILLET_LIMIT_REACHED itself. */
  async create(document: BilletDocument): Promise<BilletDetailDto> {
    const body: BilletCreateRequest = { document };
    return readable(
      await firstValueFrom(
        this.http.post<BilletDetailDto>(this.api, body, {
          context: answeredInline('BILLET_LIMIT_REACHED'),
        }),
      ),
    );
  }

  /**
   * A billet of this device, moved into the account: created there, and said so. The caller
   * answers 409 BILLET_LIMIT_REACHED and removes the device's copy.
   */
  async takeOver(document: BilletDocument): Promise<BilletDetailDto> {
    const billet = await this.create(document);
    this.messageStore.addMessage('success', 'BILLET_TAKEN_OVER');
    return billet;
  }

  /**
   * null when the account has no such billet (404, answered by the page) or when its document
   * cannot be read.
   */
  get(id: number): Promise<BilletDetailDto | null> {
    return readBillet(
      this.http.get<BilletDetailDto>(`${this.api}/${id}`, {
        context: answeredInline('BILLET_NOT_FOUND'),
      }),
    );
  }

  /**
   * The autosave. Its save status is its indicator, so it never drives the global bar; a stale
   * `version` (409 BILLET_MODIFIED_ELSEWHERE) is the caller's conflict to resolve. `refusedBefore`:
   * the previous save was refused, and its toast and the save status have said why - the same
   * refusal after every pause in typing is not toasted again.
   */
  save(
    id: number,
    version: number,
    document: BilletDocument,
    refusedBefore = false,
  ): Promise<BilletSaveResponse> {
    const body: BilletSaveRequest = { version, document };
    return firstValueFrom(
      this.http.put<BilletSaveResponse>(`${this.api}/${id}`, body, {
        context: answeredInline('BILLET_MODIFIED_ELSEWHERE')
          .set(SKIP_LOADING, true)
          .set(SKIP_ERROR_TOAST, refusedBefore),
      }),
    );
  }

  /** A billet that is already gone (deleted elsewhere) counts as removed. */
  async remove(id: number): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete<void>(`${this.api}/${id}`, {
          context: answeredInline('BILLET_NOT_FOUND'),
        }),
      );
    } catch (error) {
      if (apiErrorCode(error) !== 'BILLET_NOT_FOUND') throw error;
    }
  }

  async duplicate(id: number): Promise<BilletDetailDto> {
    const copy = readable(
      await firstValueFrom(this.http.post<BilletDetailDto>(`${this.api}/${id}/duplicate`, null)),
    );
    this.messageStore.addMessage('success', 'BILLET_DUPLICATED');
    return copy;
  }

  /**
   * Publishes the draft as of `version`; the caller saves first. A stale version (409
   * BILLET_MODIFIED_ELSEWHERE) is the caller's to answer.
   */
  publish(id: number, version: number): Promise<PublishResponse> {
    const body: PublishRequest = { version };
    return firstValueFrom(
      this.http.post<PublishResponse>(`${this.api}/${id}/publish`, body, {
        context: answeredInline('BILLET_MODIFIED_ELSEWHERE'),
      }),
    );
  }

  /** The link stops working; its token is kept, so publishing again restores the same link. */
  async unpublish(id: number): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.api}/${id}/unpublish`, null));
  }

  /**
   * All or nothing: the account takes every document or none. The limit counts the batch; the
   * caller answers 409 BILLET_LIMIT_REACHED itself.
   */
  async import(documents: BilletDocument[]): Promise<BilletImportResponse> {
    const body: BilletImportRequest = { documents };
    const imported = await firstValueFrom(
      this.http.post<BilletImportResponse>(`${this.api}/import`, body, {
        context: answeredInline('BILLET_LIMIT_REACHED'),
      }),
    );
    this.messageStore.addMessage('success', 'BILLETS_IMPORTED', undefined, {
      count: imported.billets.length,
    });
    return imported;
  }
}

/**
 * The billet the backend has just written from a document of the current version. One it cannot
 * read means this frontend is older than the backend.
 */
function readable(billet: BilletDetailDto): BilletDetailDto {
  const read = withReadableDocument(billet);
  if (!read) throw new Error(`Billet ${billet.id}: unreadable document`);
  return read;
}
