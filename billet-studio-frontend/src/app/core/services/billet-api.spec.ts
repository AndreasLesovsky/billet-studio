import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { createDocument } from '../../billet/billet-document';
import { baseUrl } from '../environments/environment';
import {
  ANSWERED_INLINE,
  SKIP_ERROR_TOAST,
  SKIP_LOADING,
} from '../interceptors/http-context-tokens';
import type { BilletDetailDto } from '../models/models';
import { MessageStore } from '../stores/message-store';
import { createMockMessageStore, type MockMessageStore } from '../../../test-helpers';
import { BilletApi } from './billet-api';

describe('BilletApi', () => {
  let api: BilletApi;
  let http: HttpTestingController;
  let messages: MockMessageStore;
  const url = `${baseUrl}billets`;
  const document = createDocument({ lang: 'de', templateId: 'geburtstag' });

  const detail = (overrides: Partial<BilletDetailDto> = {}): BilletDetailDto => ({
    id: 42,
    version: 3,
    document,
    model: null,
    published: false,
    hasUnpublishedChanges: false,
    shareToken: null,
    publishedAt: null,
    createdAt: '2026-05-01T08:00:00Z',
    updatedAt: '2026-05-01T08:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    messages = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageStore, useValue: messages },
      ],
    });
    api = TestBed.inject(BilletApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('the autosave stays off the global bar, leaves a stale version to the editor and toasts a refusal once', async () => {
    const saving = api.save(42, 3, document);
    const req = http.expectOne({ method: 'PUT', url: `${url}/42` });
    expect(req.request.body).toEqual({ version: 3, document });
    expect(req.request.context.get(SKIP_LOADING)).toBe(true);
    expect(req.request.context.get(ANSWERED_INLINE)).toEqual(['BILLET_MODIFIED_ELSEWHERE']);
    expect(req.request.context.get(SKIP_ERROR_TOAST)).toBe(false);
    req.flush({ version: 4, updatedAt: '2026-05-01T09:00:00Z', hasUnpublishedChanges: true });
    expect((await saving).version).toBe(4);

    void api.save(42, 4, document, true).catch(() => undefined);
    const again = http.expectOne({ method: 'PUT', url: `${url}/42` });
    expect(again.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    again.flush(null, { status: 500, statusText: 'Server Error' });
  });

  it('get migrates the document; a billet the account does not have is null, other failures throw', async () => {
    const loading = api.get(42);
    const req = http.expectOne(`${url}/42`);
    expect(req.request.context.get(ANSWERED_INLINE)).toEqual(['BILLET_NOT_FOUND']);
    req.flush(detail({ document: { ...document, legacy: 1 } as typeof document }));
    expect(await loading).toEqual(detail());

    const missing = api.get(7);
    http
      .expectOne(`${url}/7`)
      .flush({ errorCode: 'BILLET_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();

    const failing = api.get(8);
    http.expectOne(`${url}/8`).flush(null, { status: 500, statusText: 'Server Error' });
    await expect(failing).rejects.toBeTruthy();
  });

  it('a full account is the caller to answer; a device billet taken over is announced', async () => {
    const taking = api.takeOver(document);
    const req = http.expectOne({ method: 'POST', url });
    expect(req.request.body).toEqual({ document });
    expect(req.request.context.get(ANSWERED_INLINE)).toEqual(['BILLET_LIMIT_REACHED']);
    req.flush(detail());

    expect((await taking).id).toBe(42);
    expect(messages.addMessage).toHaveBeenCalledWith('success', 'BILLET_TAKEN_OVER');
  });
});
