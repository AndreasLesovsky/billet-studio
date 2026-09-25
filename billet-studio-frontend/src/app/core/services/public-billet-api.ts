import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { migrateDocument } from '../../billet/migrate-document';
import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import { PublicBilletDto } from '../models/models';

/**
 * A shared billet, `/v1/public/billets/{token}` - the recipient's page. That page renders every
 * outcome itself (not found, failed), so no request here ever toasts.
 */
@Injectable({ providedIn: 'root' })
export class PublicBilletApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${baseUrl}public/billets`;

  /**
   * The published snapshot, its document migrated. null when the link is unknown, unpublished or
   * its owner's account is inactive (the backend answers all three with the same 404), and when
   * the document cannot be read.
   */
  async get(shareToken: string): Promise<PublicBilletDto | null> {
    let billet: PublicBilletDto;
    try {
      billet = await firstValueFrom(
        this.http.get<PublicBilletDto>(`${this.api}/${encodeURIComponent(shareToken)}`, {
          context: new HttpContext().set(SKIP_ERROR_TOAST, true),
        }),
      );
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return null;
      throw error;
    }
    const document = migrateDocument(billet.document);
    return document ? { ...billet, document } : null;
  }
}
