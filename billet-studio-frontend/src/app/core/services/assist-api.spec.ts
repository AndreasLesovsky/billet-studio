import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AssistApi } from './assist-api';
import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST, SKIP_LOADING } from '../interceptors/http-context-tokens';

describe('AssistApi', () => {
  let api: AssistApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AssistApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('neither toasts nor drives the global bar: the assistant shows every outcome itself', async () => {
    const status = api.status();
    api.warmUp();
    const asking = api.ask({ conversation: [{ role: 'user', content: 'Hallo', billet: null }] });

    const requests = [
      http.expectOne({ method: 'GET', url: `${baseUrl}assist/status` }),
      http.expectOne({ method: 'POST', url: `${baseUrl}assist/warm-up` }),
      http.expectOne({ method: 'POST', url: `${baseUrl}assist` }),
    ];
    for (const request of requests) {
      expect(request.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
      expect(request.request.context.get(SKIP_LOADING)).toBe(true);
    }
    requests[0].flush({ status: 'IDLE' });
    requests[1].flush(null, { status: 503, statusText: '' });
    requests[2].flush({ errorCode: 'ASSIST_UNAVAILABLE' }, { status: 503, statusText: '' });

    expect(await status).toBe('IDLE');
    await expect(asking).rejects.toBeTruthy();
  });
});
