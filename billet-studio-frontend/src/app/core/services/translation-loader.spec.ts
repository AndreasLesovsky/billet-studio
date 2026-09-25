import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TranslationObject } from '@ngx-translate/core';

import { TranslationLoader } from './translation-loader';
import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import { APP_VERSION } from '../version';

describe('TranslationLoader', () => {
  let http: HttpTestingController;
  let loader: TranslationLoader;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), TranslationLoader],
    });
    http = TestBed.inject(HttpTestingController);
    loader = TestBed.inject(TranslationLoader);
  });

  afterEach(() => http.verify());

  it('loads i18n/<lang>.json relative to the base href, versioned against stale caches', () => {
    let result: TranslationObject | undefined;
    loader.getTranslation('en').subscribe((r) => (result = r));

    const req = http.expectOne((r) => r.url === 'i18n/en.json');
    expect(req.request.params.get('v')).toBe(APP_VERSION);
    req.flush({ COMMON: { SAVE: 'Save' } });

    expect(result).toEqual({ COMMON: { SAVE: 'Save' } });
  });

  it('never toasts its own failure - the toast text would come from the missing file', () => {
    loader.getTranslation('de').subscribe({ error: () => undefined });

    const req = http.expectOne((r) => r.url === 'i18n/de.json');
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    req.flush('not found', { status: 404, statusText: 'Not Found' });
  });
});
