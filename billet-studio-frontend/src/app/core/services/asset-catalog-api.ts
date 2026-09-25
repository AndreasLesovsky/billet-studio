import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { baseUrl } from '../environments/environment';
import { ANSWERED_INLINE } from '../interceptors/http-context-tokens';
import { ModelAssetDto } from '../models/models';

/**
 * The 3D model library, `/v1/models` (public). The catalog only changes with a deployment, so both
 * reads are cached for the session; a failed read is forgotten, so the next call retries.
 */
@Injectable({ providedIn: 'root' })
export class AssetCatalogApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${baseUrl}models`;

  private readonly listed = signal<readonly ModelAssetDto[] | null>(null);
  private listRequest: Promise<readonly ModelAssetDto[]> | null = null;
  private readonly slugRequests = new Map<string, Promise<ModelAssetDto | null>>();

  /** The active models in library order; null until list() has answered. */
  readonly models = this.listed.asReadonly();

  list(): Promise<readonly ModelAssetDto[]> {
    this.listRequest ??= firstValueFrom(this.http.get<ModelAssetDto[]>(this.api)).then(
      (models) => {
        this.listed.set(models);
        return models;
      },
      (error: unknown) => {
        this.listRequest = null;
        throw error;
      },
    );
    return this.listRequest;
  }

  /**
   * One model, inactive ones included (a billet may still use a retired model); null for an
   * unknown slug, without a toast - the caller shows that state.
   */
  get(slug: string): Promise<ModelAssetDto | null> {
    const listed = this.listed()?.find((model) => model.slug === slug);
    if (listed) return Promise.resolve(listed);

    let request = this.slugRequests.get(slug);
    if (!request) {
      request = firstValueFrom(
        this.http.get<ModelAssetDto>(`${this.api}/${encodeURIComponent(slug)}`, {
          context: new HttpContext().set(ANSWERED_INLINE, ['MODEL_NOT_FOUND']),
        }),
      ).catch((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) return null;
        this.slugRequests.delete(slug);
        throw error;
      });
      this.slugRequests.set(slug, request);
    }
    return request;
  }
}
