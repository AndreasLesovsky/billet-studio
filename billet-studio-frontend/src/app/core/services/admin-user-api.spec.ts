import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminUserApi, UserListQuery } from './admin-user-api';
import { AuthApi } from './auth-api';
import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { UserRequestDto } from '../models/models';
import {
  createMockAuthApi,
  createMockMessageStore,
  MockAuthApi,
  MockMessageStore,
  testUser,
} from '../../../test-helpers';

const QUERY: UserListQuery = {
  page: 0,
  size: 20,
  q: '',
  active: null,
  sort: 'createdAt',
  direction: 'desc',
};

function request(overrides: Partial<UserRequestDto> = {}): UserRequestDto {
  return {
    name: 'Ben',
    email: 'ben@example.com',
    password: '',
    role: 'ROLE_USER',
    preferredLanguage: 'de',
    active: true,
    deactivationReason: null,
    ...overrides,
  };
}

/** Lets the awaited rotateCredential() hand over before the request is looked for. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('AdminUserApi', () => {
  let api: AdminUserApi;
  let http: HttpTestingController;
  let messageStore: MockMessageStore;
  let authApi: MockAuthApi;
  const url = `${baseUrl}users`;

  beforeEach(() => {
    messageStore = createMockMessageStore();
    authApi = createMockAuthApi({ user: testUser({ id: 1, role: 'ROLE_ADMIN' }) });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageStore, useValue: messageStore },
        { provide: AuthApi, useValue: authApi },
        AdminUserApi,
      ],
    });
    api = TestBed.inject(AdminUserApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list', () => {
    it('sends page, size and sort, and leaves out an empty search and an unset status', async () => {
      const promise = api.list(QUERY);
      const req = http.expectOne((r) => r.url === url && r.method === 'GET');
      expect(req.request.params.keys().sort()).toEqual(['page', 'size', 'sort']);
      expect(req.request.params.get('page')).toBe('0');
      expect(req.request.params.get('size')).toBe('20');
      expect(req.request.params.get('sort')).toBe('createdAt,desc');
      req.flush({ rows: [], totalRows: 0, page: 0, size: 20 });

      expect((await promise).totalRows).toBe(0);
    });

    it('sends a trimmed search term and the status filter when set', async () => {
      const promise = api.list({
        ...QUERY,
        q: '  anna ',
        active: false,
        sort: 'name',
        direction: 'asc',
      });
      const req = http.expectOne((r) => r.url === url);
      expect(req.request.params.get('q')).toBe('anna');
      expect(req.request.params.get('active')).toBe('false');
      expect(req.request.params.get('sort')).toBe('name,asc');
      req.flush({ rows: [], totalRows: 0, page: 0, size: 20 });
      await promise;
    });

    it('reading is silent: no success toast', async () => {
      const promise = api.list(QUERY);
      http.expectOne((r) => r.url === url).flush({ rows: [], totalRows: 0, page: 0, size: 20 });
      await promise;

      expect(messageStore.addMessage).not.toHaveBeenCalled();
    });
  });

  it('loadRoles stores the roles', async () => {
    const promise = api.loadRoles();
    http.expectOne({ method: 'GET', url: `${url}/roles` }).flush(['ROLE_USER', 'ROLE_ADMIN']);

    await promise;
    expect(api.roles()).toEqual(['ROLE_USER', 'ROLE_ADMIN']);
  });

  it('get reads one user', async () => {
    const promise = api.get(5);
    http.expectOne({ method: 'GET', url: `${url}/5` }).flush({ id: 5 });

    expect((await promise).id).toBe(5);
  });

  it('create POSTs the UserRequestDto and confirms', async () => {
    const dto = request({ password: 'Secret123' });
    const promise = api.create(dto);
    const req = http.expectOne({ method: 'POST', url });
    expect(req.request.body).toEqual(dto);
    req.flush({ id: 5 }, { status: 201, statusText: 'Created' });

    await promise;
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'USER_CREATED');
  });

  describe('update', () => {
    it('editing someone else is a plain PUT, even with a new password', async () => {
      const promise = api.update(5, request({ password: 'Secret123' }));
      http.expectOne({ method: 'PUT', url: `${url}/5` }).flush({ id: 5 });

      await promise;
      expect(authApi.rotateCredential).not.toHaveBeenCalled();
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'USER_UPDATED');
    });

    it('editing yourself without a new password is a plain PUT', async () => {
      const promise = api.update(1, request({ password: '' }));
      http.expectOne({ method: 'PUT', url: `${url}/1` }).flush({ id: 1 });

      await promise;
      expect(authApi.rotateCredential).not.toHaveBeenCalled();
    });

    it('changing your OWN password opens the rotation window', async () => {
      // The server ends every session of the account and hands this device a new cookie.
      const promise = api.update(1, request({ password: 'Secret123' }));
      await flushMicrotasks();
      http.expectOne({ method: 'PUT', url: `${url}/1` }).flush({ id: 1 });

      await promise;
      expect(authApi.rotateCredential).toHaveBeenCalledOnce();
    });

    it('a protected account rethrows without a success toast', async () => {
      const promise = api.update(2, request());
      http
        .expectOne(`${url}/2`)
        .flush({ errorCode: 'ROOT_USER_PROTECTED' }, { status: 403, statusText: 'Forbidden' });

      await expect(promise).rejects.toBeTruthy();
      expect(messageStore.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('toggleActive', () => {
    it('sends the reason and reports a lock', async () => {
      const promise = api.toggleActive(5, 'SPAM');
      const req = http.expectOne({ method: 'PATCH', url: `${url}/5/active` });
      expect(req.request.body).toEqual({ reason: 'SPAM' });
      req.flush({ id: 5, active: false });

      await promise;
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'USER_DEACTIVATED');
    });

    it('sends null without a reason and reports an unlock', async () => {
      const promise = api.toggleActive(5, null);
      const req = http.expectOne(`${url}/5/active`);
      expect(req.request.body).toEqual({ reason: null });
      req.flush({ id: 5, active: true });

      await promise;
      expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'USER_ACTIVATED');
    });
  });

  it('delete DELETEs and confirms', async () => {
    const promise = api.delete(5);
    http.expectOne({ method: 'DELETE', url: `${url}/5` }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await promise;
    expect(messageStore.addMessage).toHaveBeenCalledWith('success', 'USER_DELETED');
  });
});
