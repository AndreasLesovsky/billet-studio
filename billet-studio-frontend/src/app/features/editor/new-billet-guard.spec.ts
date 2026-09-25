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
import { LanguageService } from '../../core/services/language-service';
import { LocalBilletStore, MAX_LOCAL_BILLETS } from '../../core/services/local-billet-store';
import { MessageStore } from '../../core/stores/message-store';
import { createMockMessageStore, type MockMessageStore } from '../../../test-helpers';
import { newBilletGuard } from './new-billet-guard';

describe('newBilletGuard', () => {
  let store: LocalBilletStore;
  let messages: MockMessageStore;

  function open(template?: string): string {
    const route = {
      queryParamMap: convertToParamMap(template === undefined ? {} : { template }),
    } as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      newBilletGuard(route, {} as RouterStateSnapshot),
    );
    return (result as UrlTree).toString();
  }

  const editorOf = (url: string) => /^\/billets\/local\/([a-z0-9]+)\/edit$/.exec(url)?.[1] ?? '';

  beforeEach(() => {
    localStorage.clear();
    messages = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LanguageService, useValue: { currentLang: signal('en') } },
        { provide: MessageStore, useValue: messages },
      ],
    });
    store = TestBed.inject(LocalBilletStore);
  });

  it('stores the template in the interface language and opens its editor', () => {
    const localId = editorOf(open('geburtstag'));

    const expected = createDocument({ lang: 'en', templateId: 'geburtstag' });
    const stored = store.load(localId)!;
    expect(stored.title).toBe(expected.title);
    expect(stored.blocks.map((b) => b.text)).toEqual(expected.blocks.map((b) => b.text));
    expect(store.list()[0]).toMatchObject({ localId, templateId: 'geburtstag' });
  });

  it.each([undefined, 'nope', ''])('starts blank for the template %j', (template) => {
    const localId = editorOf(open(template));

    expect(store.load(localId)).toEqual({
      ...createDocument({ lang: 'en' }),
      blocks: [],
    });
    expect(store.list()[0].templateId).toBeNull();
  });

  it('when the device is full, says so and shows the list instead', () => {
    for (let i = 0; i < MAX_LOCAL_BILLETS; i++) store.create(createDocument({ lang: 'de' }));

    expect(open('muttertag')).toBe('/billets');
    expect(messages.addMessage).toHaveBeenCalledWith(
      'error',
      'LOCAL_BILLET_LIMIT_REACHED',
      undefined,
      { max: MAX_LOCAL_BILLETS },
    );
    expect(store.list()).toHaveLength(MAX_LOCAL_BILLETS);
  });
});
