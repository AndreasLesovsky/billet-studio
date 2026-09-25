import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocument } from '../../billet/billet-document';
import { LocalBilletError, LocalBilletStore, MAX_LOCAL_BILLETS } from './local-billet-store';

const INDEX_KEY = 'billet-studio.local.index';
const docKey = (localId: string) => `billet-studio.local.doc.${localId}`;

describe('LocalBilletStore', () => {
  let store: LocalBilletStore;

  const billet = (title = 'Für Mama') => ({
    ...createDocument({ lang: 'de', templateId: 'muttertag' }),
    title,
  });

  /** What another tab does: write the storage, then this tab hears the storage event. */
  function otherTabWrites(key: string, value: string | null): void {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }

  function errorCode(action: () => unknown): string | null {
    try {
      action();
      return null;
    } catch (error) {
      return error instanceof LocalBilletError ? error.code : 'not a LocalBilletError';
    }
  }

  beforeEach(() => {
    localStorage.clear();
    store = TestBed.inject(LocalBilletStore);
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates, lists newest first, saves and removes', () => {
    const first = store.create(billet('Erstes'), 'muttertag');
    const second = store.create(billet('Zweites'));

    expect(store.list().map((entry) => entry.title)).toEqual(['Zweites', 'Erstes']);
    expect(store.list()[1]).toMatchObject({
      localId: first,
      theme: 'rose',
      modelSlug: 'flower-bouquet',
      templateId: 'muttertag',
    });

    store.save(first, {
      ...billet('Erstes, geändert'),
      scene: { ...billet().scene, enabled: false },
    });
    expect(store.list()[0]).toMatchObject({
      localId: first,
      title: 'Erstes, geändert',
      modelSlug: null,
      templateId: 'muttertag',
    });

    store.remove(second);
    expect(store.list().map((entry) => entry.localId)).toEqual([first]);
    expect(localStorage.getItem(docKey(second))).toBeNull();
  });

  it(`refuses billet ${MAX_LOCAL_BILLETS + 1} with a typed error and stores nothing of it`, () => {
    for (let i = 0; i < MAX_LOCAL_BILLETS; i++) store.create(billet(`Billet ${i}`));
    const keysBefore = localStorage.length;

    expect(errorCode(() => store.create(billet()))).toBe('LOCAL_BILLET_LIMIT_REACHED');
    expect(errorCode(() => store.duplicate(store.list()[0].localId))).toBe(
      'LOCAL_BILLET_LIMIT_REACHED',
    );
    expect(localStorage.length).toBe(keysBefore);
    expect(store.list()).toHaveLength(MAX_LOCAL_BILLETS);
  });

  it('a full storage is a typed error, and a failed create leaves no orphan document', () => {
    const localId = store.create(billet('Vorher'));
    const quota = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };

    const realSetItem = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(quota);
    expect(errorCode(() => store.save(localId, billet('Nachher')))).toBe('LOCAL_STORAGE_FULL');
    expect(store.load(localId)?.title).toBe('Vorher');

    // The document fits, the index does not.
    setItem.mockImplementation((key, value) => {
      if (key === INDEX_KEY) quota();
      realSetItem(key, value);
    });
    const keysBefore = localStorage.length;
    expect(errorCode(() => store.create(billet()))).toBe('LOCAL_STORAGE_FULL');
    expect(localStorage.length).toBe(keysBefore);
    expect(store.list()).toHaveLength(1);
  });

  it('migrates what it loads, and answers null for anything that is not a billet', () => {
    const localId = store.create(billet());
    const stored = JSON.parse(localStorage.getItem(docKey(localId))!);
    localStorage.setItem(
      docKey(localId),
      JSON.stringify({ ...stored, title: 'Tab\there', legacyField: true, blocks: 'none' }),
    );

    const loaded = store.load(localId)!;
    expect(loaded.title).toBe('Tab here');
    expect(loaded.blocks).toEqual([]);
    expect(loaded).not.toHaveProperty('legacyField');

    localStorage.setItem(docKey(localId), '{ not json');
    expect(store.load(localId)).toBeNull();
    localStorage.setItem(docKey(localId), JSON.stringify({ ...stored, schemaVersion: 99 }));
    expect(store.load(localId)).toBeNull();
    expect(store.load('unknown')).toBeNull();
  });

  it('an unreadable index loses no billet: the documents are listed again and re-indexed', () => {
    const first = store.create(billet('Eins'), 'muttertag');
    const second = store.create(billet('Zwei'));

    otherTabWrites(INDEX_KEY, '{ not json');
    expect(
      store
        .list()
        .map((entry) => entry.localId)
        .sort(),
    ).toEqual([first, second].sort());

    store.save(first, billet('Eins, wieder da'));
    const index = JSON.parse(localStorage.getItem(INDEX_KEY)!);
    expect(index.map((entry: { title: string }) => entry.title).sort()).toEqual([
      'Eins, wieder da',
      'Zwei',
    ]);
  });

  it('follows other tabs: the list updates, and an open editor hears about its document', () => {
    const localId = store.create(billet('Hier'));
    const heard: (string | null)[] = [];
    const subscription = store.changedElsewhere.subscribe((id) => heard.push(id));

    const index = JSON.parse(localStorage.getItem(INDEX_KEY)!);
    otherTabWrites(INDEX_KEY, JSON.stringify([{ ...index[0], title: 'Dort umbenannt' }]));
    expect(store.list()[0].title).toBe('Dort umbenannt');
    expect(heard).toEqual([]);

    otherTabWrites(docKey(localId), JSON.stringify(billet('Dort geändert')));
    otherTabWrites(docKey(localId), null);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(heard).toEqual([localId, localId, null]);
    subscription.unsubscribe();
  });
});
