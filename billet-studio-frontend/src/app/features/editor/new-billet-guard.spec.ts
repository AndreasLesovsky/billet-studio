import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDocument } from '../../billet/billet-document';
import { AccessToken } from '../../core/services/access-token';
import { AuthApi } from '../../core/services/auth-api';
import { LanguageService } from '../../core/services/language-service';
import { LocalBilletStore, MAX_LOCAL_BILLETS } from '../../core/services/local-billet-store';
import { MessageStore } from '../../core/stores/message-store';
import {
  createMockAccessToken,
  createMockAuthApi,
  createMockMessageStore,
  testUser,
  type MockAuthApi,
  type MockMessageStore,
} from '../../../test-helpers';
import { newBilletGuard } from './new-billet-guard';

describe('newBilletGuard', () => {
  let store: LocalBilletStore;
  let messages: MockMessageStore;
  let auth: MockAuthApi;

  async function open(template?: string): Promise<string | true> {
    const route = {
      queryParamMap: convertToParamMap(template === undefined ? {} : { template }),
    } as ActivatedRouteSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      newBilletGuard(route, {} as RouterStateSnapshot),
    );
    return result === true ? true : (result as UrlTree).toString();
  }

  const editorOf = (url: string | true) =>
    /^\/billets\/local\/([a-z0-9]+)\/edit$/.exec(String(url))?.[1] ?? '';

  beforeEach(() => {
    localStorage.clear();
    messages = createMockMessageStore();
    auth = createMockAuthApi();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LanguageService, useValue: { currentLang: signal('en') } },
        { provide: MessageStore, useValue: messages },
        { provide: AuthApi, useValue: auth },
        { provide: AccessToken, useValue: createMockAccessToken() },
      ],
    });
    store = TestBed.inject(LocalBilletStore);
  });

  it('stores the template in the interface language and opens its editor', async () => {
    const localId = editorOf(await open('geburtstag'));

    const expected = createDocument({ lang: 'en', templateId: 'geburtstag' });
    const stored = store.load(localId)!;
    expect(stored.title).toBe(expected.title);
    expect(stored.blocks.map((b) => b.text)).toEqual(expected.blocks.map((b) => b.text));
    expect(store.list()[0]).toMatchObject({ localId, templateId: 'geburtstag' });
  });

  it.each([undefined, 'nope', ''])('starts blank for the template %j', async (template) => {
    const localId = editorOf(await open(template));

    expect(store.load(localId)).toEqual({
      ...createDocument({ lang: 'en' }),
      blocks: [],
    });
    expect(store.list()[0].templateId).toBeNull();
  });

  it('when the device is full, says so and shows the list instead', async () => {
    for (let i = 0; i < MAX_LOCAL_BILLETS; i++) store.create(createDocument({ lang: 'de' }));

    expect(await open('muttertag')).toBe('/billets');
    expect(messages.addMessage).toHaveBeenCalledWith(
      'error',
      'LOCAL_BILLET_LIMIT_REACHED',
      undefined,
      { max: MAX_LOCAL_BILLETS },
    );
    expect(store.list()).toHaveLength(MAX_LOCAL_BILLETS);
  });

  it('lets a signed-in user through to the account page and stores nothing here', async () => {
    auth.user.set(testUser());
    auth.isLoggedIn.set(true);

    expect(await open('muttertag')).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
