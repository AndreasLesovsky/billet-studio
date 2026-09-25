import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UserApi } from './user-api';
import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { createMockMessageStore, MockMessageStore } from '../../../test-helpers';

describe('UserApi', () => {
  let api: UserApi;
  let http: HttpTestingController;
  let messageStore: MockMessageStore;
  const dto = {
    name: 'Anna',
    email: 'anna@example.com',
    password: 'Secret123',
    preferredLanguage: 'de',
  };

  beforeEach(() => {
    messageStore = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageStore, useValue: messageStore },
        UserApi,
      ],
    });
    api = TestBed.inject(UserApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('register POSTs the RegisterRequestDto to the public auth endpoint and confirms', async () => {
    const promise = api.register(dto);
    const req = http.expectOne({ method: 'POST', url: `${baseUrl}auth/register` });
    expect(req.request.body).toEqual(dto);
    req.flush({ id: 5, name: 'Anna' }, { status: 201, statusText: 'Created' });

    expect((await promise).id).toBe(5);
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'REGISTRATION_SUCCESS');
  });

  it('a taken email rethrows without a success toast', async () => {
    const promise = api.register(dto);
    http
      .expectOne(`${baseUrl}auth/register`)
      .flush({ errorCode: 'EMAIL_ALREADY_EXISTS' }, { status: 409, statusText: 'Conflict' });

    await expect(promise).rejects.toBeTruthy();
    expect(messageStore.addMessage).not.toHaveBeenCalled();
  });
});
