import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { createDocument } from '../../billet/billet-document';
import { PublicBilletApi } from './public-billet-api';
import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';

describe('PublicBilletApi', () => {
  let api: PublicBilletApi;
  let http: HttpTestingController;
  const url = `${baseUrl}public/billets/tok_en-22`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PublicBilletApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('hands over the snapshot with its document migrated, never toasting', async () => {
    const document = createDocument({ lang: 'de', templateId: 'geburtstag' });
    const promise = api.get('tok_en-22');
    const req = http.expectOne({ method: 'GET', url });
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush({
      document: { ...document, legacy: 1 },
      model: null,
      publishedAt: '2026-05-10T08:00:00Z',
    });

    expect(await promise).toEqual({ document, model: null, publishedAt: '2026-05-10T08:00:00Z' });
  });

  it('an unknown or unpublished link is null; any other failure is thrown', async () => {
    const missing = api.get('tok_en-22');
    http
      .expectOne(url)
      .flush({ errorCode: 'BILLET_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();

    const limited = api.get('tok_en-22');
    http
      .expectOne(url)
      .flush({ errorCode: 'RATE_LIMIT_EXCEEDED' }, { status: 429, statusText: 'Too Many' });
    await expect(limited).rejects.toBeTruthy();
  });
});
