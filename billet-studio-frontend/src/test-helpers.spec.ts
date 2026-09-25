import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import {
  createMockAccessToken,
  createMockActivatedRoute,
  createMockAuthApi,
  createMockMessageStore,
  createMockRouter,
  fileOf,
  testUser,
  translateTestingModule,
} from './test-helpers';

describe('test-helpers', () => {
  it('createMockRouter exposes navigate spy and initial url', () => {
    const r = createMockRouter('/foo');
    expect(r.url).toBe('/foo');
    void r.navigate(['/login']);
    expect(r.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('createMockRouter.createUrlTree records calls and returns a stub UrlTree', () => {
    const r = createMockRouter();
    const tree = r.createUrlTree(['/login'], { queryParams: { returnUrl: '/x' } });
    expect(r.createUrlTree).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/x' } });
    expect(String(tree)).toBe('urltree:/login');
  });

  it('createMockMessageStore tracks addMessage calls', () => {
    const m = createMockMessageStore();
    m.addMessage('error', 'SESSION_EXPIRED');
    expect(m.addMessage).toHaveBeenCalledWith('error', 'SESSION_EXPIRED');
  });

  it('createMockActivatedRoute returns query and path params', () => {
    const route = createMockActivatedRoute({ returnUrl: '/billets' }, { id: '7' });
    expect(route.snapshot?.queryParamMap.get('returnUrl')).toBe('/billets');
    expect(route.snapshot?.queryParamMap.get('missing')).toBeNull();
    expect(route.snapshot?.paramMap.get('id')).toBe('7');
  });

  it('createMockAuthApi: passing a user means logged in, with that role', async () => {
    const auth = createMockAuthApi({ user: testUser({ role: 'ROLE_ADMIN' }) });
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.role()).toBe('ROLE_ADMIN');
    await auth.restoreSession();
    expect(auth.restoreSession).toHaveBeenCalled();
    await expect(auth.rotateCredential(async () => 'done')).resolves.toBe('done');
  });

  it('createMockAuthApi without arguments is a guest', () => {
    const auth = createMockAuthApi();
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('createMockAccessToken: a token implies a possible session unless overridden', () => {
    expect(createMockAccessToken({ token: 'jwt' }).couldHaveSession()).toBe(true);
    expect(createMockAccessToken().couldHaveSession()).toBe(false);
    expect(createMockAccessToken({ couldHaveSession: true }).get()).toBeNull();
  });

  it('fileOf fakes a size without allocating it', () => {
    expect(fileOf(20 * 1024 * 1024).size).toBe(20 * 1024 * 1024);
  });

  it('translateTestingModule provides TranslateService with keys rendering as themselves', async () => {
    TestBed.configureTestingModule({ imports: [translateTestingModule()] });
    const translate = TestBed.inject(TranslateService);
    await firstValueFrom(translate.use('de'));

    expect(translate.instant('COMMON.SAVE')).toBe('COMMON.SAVE');
  });
});
