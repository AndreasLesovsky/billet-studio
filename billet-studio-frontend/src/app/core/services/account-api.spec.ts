import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AccountApi } from './account-api';
import { AuthApi } from './auth-api';
import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { AccountDto } from '../models/models';
import {
  createMockAuthApi,
  createMockMessageStore,
  MockAuthApi,
  MockMessageStore,
  testUser,
} from '../../../test-helpers';

function account(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: 7,
    name: 'Anna',
    email: 'anna@example.com',
    role: 'ROLE_USER',
    preferredLanguage: 'de',
    avatarUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Lets the awaited rotateCredential() hand over before the request is looked for. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('AccountApi', () => {
  let api: AccountApi;
  let http: HttpTestingController;
  let messageStore: MockMessageStore;
  let authApi: MockAuthApi;
  const url = `${baseUrl}account`;

  beforeEach(() => {
    messageStore = createMockMessageStore();
    authApi = createMockAuthApi({ user: testUser({ id: 7 }) });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageStore, useValue: messageStore },
        { provide: AuthApi, useValue: authApi },
        AccountApi,
      ],
    });
    api = TestBed.inject(AccountApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('forgets the account once someone else is signed in, instead of showing their data', async () => {
    const promise = api.get();
    http.expectOne({ method: 'GET', url }).flush(account({ id: 7 }));
    await promise;
    expect(api.account()?.id).toBe(7);

    authApi.user.set(testUser({ id: 8 }));

    expect(api.account()).toBeNull();
  });

  it('update PUTs name + language, patches the header name and confirms', async () => {
    const promise = api.update({ name: 'Anne', preferredLanguage: 'en' });
    const req = http.expectOne({ method: 'PUT', url });
    expect(req.request.body).toEqual({ name: 'Anne', preferredLanguage: 'en' });
    req.flush(account({ name: 'Anne', preferredLanguage: 'en' }));

    await promise;
    expect(api.account()?.name).toBe('Anne');
    expect(authApi.patchName).toHaveBeenCalledWith('Anne');
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'ACCOUNT_UPDATED');
  });

  it('update rethrows and shows no success toast', async () => {
    const promise = api.update({ name: 'Anne', preferredLanguage: 'de' });
    http
      .expectOne(url)
      .flush({ errorCode: 'VALIDATION_ERROR' }, { status: 400, statusText: 'Bad Request' });

    await expect(promise).rejects.toBeTruthy();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
    expect(authApi.patchName).not.toHaveBeenCalled();
  });

  it('changePassword runs inside the credential rotation window', async () => {
    const dto = {
      currentPassword: 'Old12345',
      newPassword: 'New12345',
      confirmPassword: 'New12345',
    };
    const promise = api.changePassword(dto);
    await flushMicrotasks();

    const req = http.expectOne({ method: 'POST', url: `${url}/change-password` });
    expect(req.request.body).toEqual(dto);
    req.flush(null, { status: 204, statusText: 'No Content' });

    await promise;
    expect(authApi.rotateCredential).toHaveBeenCalledOnce();
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'PASSWORD_CHANGED');
  });

  it('deactivate posts password + reason, confirms and ends the session here too', async () => {
    const promise = api.deactivate({ password: 'Secret123', reason: 'OTHER' });
    const req = http.expectOne({ method: 'POST', url: `${url}/deactivate` });
    expect(req.request.body).toEqual({ password: 'Secret123', reason: 'OTHER' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    await promise;
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'ACCOUNT_DEACTIVATED');
    expect(authApi.endSession).toHaveBeenCalledWith({ reason: 'deactivated' });
  });

  it('a refused deactivation (wrong password) keeps the session', async () => {
    const promise = api.deactivate({ password: 'wrong', reason: null });
    http
      .expectOne(`${url}/deactivate`)
      .flush({ errorCode: 'INVALID_PASSWORD' }, { status: 400, statusText: 'Bad Request' });

    await expect(promise).rejects.toBeTruthy();
    expect(authApi.endSession).not.toHaveBeenCalled();
  });

  it('uploadAvatar POSTs the file as the multipart "image" part and patches the header', async () => {
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    const promise = api.uploadAvatar(file);

    const req = http.expectOne({ method: 'POST', url: `${url}/avatar` });
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('image')).toBe(file);
    req.flush(account({ avatarUrl: '/uploads/avatars/7.webp' }));

    await promise;
    expect(api.account()?.avatarUrl).toBe('/uploads/avatars/7.webp');
    expect(authApi.patchAvatar).toHaveBeenCalledWith('/uploads/avatars/7.webp');
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'AVATAR_UPDATED');
  });

  it('uploadAvatar rethrows on error and shows no success toast', async () => {
    const promise = api.uploadAvatar(new File(['x'], 'me.png', { type: 'image/png' }));
    http
      .expectOne(`${url}/avatar`)
      .flush({ errorCode: 'FILE_TOO_LARGE' }, { status: 413, statusText: 'Payload Too Large' });

    await expect(promise).rejects.toBeTruthy();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
    expect(authApi.patchAvatar).not.toHaveBeenCalled();
  });

  it('removeAvatar DELETEs and patches the header avatar to null', async () => {
    const promise = api.removeAvatar();
    http.expectOne({ method: 'DELETE', url: `${url}/avatar` }).flush(account());

    await promise;
    expect(authApi.patchAvatar).toHaveBeenCalledWith(null);
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'AVATAR_REMOVED');
  });
});
