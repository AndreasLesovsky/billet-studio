import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { baseUrl } from '../environments/environment';
import { AdminBilletDto, PageDto } from '../models/models';
import { SortDirection } from './admin-user-api';

export type BilletSortField = 'title' | 'owner' | 'createdAt' | 'updatedAt';

/**
 * One page of the admin billet overview. `q` matches the title or the owner's name or email;
 * `published` null = drafts and published billets.
 */
export interface BilletListQuery {
  page: number;
  size: number;
  q: string;
  published: boolean | null;
  sort: BilletSortField;
  direction: SortDirection;
}

/** The read-only admin overview of every user's billets, `/v1/admin/billets` (ROLE_ADMIN). */
@Injectable({ providedIn: 'root' })
export class AdminBilletApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${baseUrl}admin/billets`;

  async list(query: BilletListQuery): Promise<PageDto<AdminBilletDto>> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('size', query.size)
      .set('sort', `${query.sort},${query.direction}`);
    const q = query.q.trim();
    if (q) params = params.set('q', q);
    if (query.published !== null) params = params.set('published', query.published);
    return firstValueFrom(this.http.get<PageDto<AdminBilletDto>>(this.api, { params }));
  }
}
