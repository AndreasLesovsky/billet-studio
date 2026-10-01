import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  convertToParamMap,
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  type UrlTree,
} from '@angular/router';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createDocument } from '../../billet/billet-document';
import type { ModelAssetDto } from '../../core/models/models';
import { AccessToken } from '../../core/services/access-token';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
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
  let list: Mock<() => Promise<readonly ModelAssetDto[]>>;

  async function open(
    template?: string,
    more: Record<string, string> = {},
  ): Promise<string | true> {
    const route = {
      queryParamMap: convertToParamMap(template === undefined ? more : { template, ...more }),
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
    list = vi.fn(async () => []);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LanguageService, useValue: { currentLang: signal('en') } },
        { provide: MessageStore, useValue: messages },
        { provide: AuthApi, useValue: auth },
        { provide: AccessToken, useValue: createMockAccessToken() },
        { provide: AssetCatalogApi, useValue: { list } },
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

  it('stores the start link: theme, a library model and the colour mode', async () => {
    list.mockResolvedValue([
      {
        slug: 'gift-box',
        nameDe: 'Geschenk',
        nameEn: 'Gift box',
        occasion: 'general',
        fileUrl: 'models/gift-box.v1.glb',
        previewUrl: 'models/previews/gift-box.v1.webp',
        fileSizeBytes: 1,
        credit: null,
        active: true,
        defaults: {
          fitSize: 1.3,
          yOffset: -0.08,
          exposure: 0.6,
          cameraDistance: 2.8,
          cameraHeight: 0.1,
          autoRotateSpeed: 0.45,
        },
      },
    ]);

    const localId = editorOf(
      await open('geburtstag', { theme: 'midnight', model: 'gift-box', colorMode: 'dark' }),
    );

    expect(store.load(localId)).toMatchObject({
      theme: 'midnight',
      colorMode: 'dark',
      scene: { modelSlug: 'gift-box', ariaLabel: '3D Gift box, drag to rotate' },
    });
  });

  it('keeps the template model when the library cannot be read', async () => {
    list.mockRejectedValue(new Error('offline'));

    const localId = editorOf(await open('geburtstag', { model: 'gift-box' }));

    expect(store.load(localId)?.scene.modelSlug).toBe('birthday-cake');
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
