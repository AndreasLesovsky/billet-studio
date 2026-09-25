import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssetCatalogApi } from './asset-catalog-api';
import { baseUrl } from '../environments/environment';
import { ANSWERED_INLINE } from '../interceptors/http-context-tokens';
import { ModelAssetDto } from '../models/models';

function model(slug: string, active = true): ModelAssetDto {
  return {
    slug,
    nameDe: slug,
    nameEn: slug,
    occasion: 'general',
    fileUrl: `https://cdn.example/models/${slug}.v1.glb`,
    previewUrl: `https://cdn.example/models/previews/${slug}.v1.webp`,
    fileSizeBytes: 1000,
    credit: null,
    active,
    defaults: {
      fitSize: 1.6,
      yOffset: -0.08,
      exposure: 0.6,
      cameraDistance: 2.8,
      cameraHeight: 0.1,
      autoRotateSpeed: 0.45,
    },
  };
}

describe('AssetCatalogApi', () => {
  let api: AssetCatalogApi;
  let http: HttpTestingController;
  const url = `${baseUrl}models`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AssetCatalogApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the library once per session and answers listed slugs from it', async () => {
    const first = api.list();
    http.expectOne({ method: 'GET', url }).flush([model('gift-box')]);
    await first;

    expect(await api.list()).toEqual([model('gift-box')]);
    expect(await api.get('gift-box')).toEqual(model('gift-box'));
  });

  it('a failed library read is retried by the next call', async () => {
    const failed = api.list();
    http
      .expectOne(url)
      .flush({ errorCode: 'INTERNAL_SERVER_ERROR' }, { status: 500, statusText: '' });
    await expect(failed).rejects.toBeTruthy();

    const retry = api.list();
    http.expectOne(url).flush([]);
    expect(await retry).toEqual([]);
  });

  it('an unknown slug is null without a toast, and not asked for twice', async () => {
    const lookup = api.get('retired');
    const req = http.expectOne(`${url}/retired`);
    expect(req.request.context.get(ANSWERED_INLINE)).toEqual(['MODEL_NOT_FOUND']);
    req.flush({ errorCode: 'MODEL_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });

    expect(await lookup).toBeNull();
    expect(await api.get('retired')).toBeNull();
  });
});
