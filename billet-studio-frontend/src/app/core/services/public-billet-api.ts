import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';

import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import { PublicBilletDto } from '../models/models';
import { readBillet } from '../utils/read-billet';

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
  get(shareToken: string): Promise<PublicBilletDto | null> {
    return readBillet(
      this.http.get<PublicBilletDto>(`${this.api}/${encodeURIComponent(shareToken)}`, {
        context: new HttpContext().set(SKIP_ERROR_TOAST, true),
      }),
    );
  }
}
