import { DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { BilletDocument } from '../../billet/billet-document';
import { migrateDocument } from '../../billet/migrate-document';
import { TEMPLATE_IDS, type TemplateId } from '../../billet/templates/templates';

const INDEX_KEY = 'billet-studio.local.index';
const DOC_KEY_PREFIX = 'billet-studio.local.doc.';

/** Billets one browser keeps; a guest's whole collection. */
export const MAX_LOCAL_BILLETS = 20;

/** One billet in the index: what the list shows without reading the document. */
export interface LocalBilletEntry {
  readonly localId: string;
  readonly title: string;
  readonly theme: string;
  /** Null while the billet shows no 3D scene. */
  readonly modelSlug: string | null;
  /** The template it was started from; null for a blank start. */
  readonly templateId: TemplateId | null;
  /** ISO-8601 instant of the last save. */
  readonly updatedAt: string;
}

/** Each code is also the toast: MESSAGES.ERROR.<code>. */
export type LocalBilletErrorCode =
  'LOCAL_BILLET_LIMIT_REACHED' | 'LOCAL_STORAGE_FULL' | 'LOCAL_STORAGE_UNAVAILABLE';

export class LocalBilletError extends Error {
  constructor(readonly code: LocalBilletErrorCode) {
    super(code);
    this.name = 'LocalBilletError';
  }
}

/**
 * The billets kept in this browser (guests, and for now signed-in users too): an index under one
 * localStorage key and one key per document. Every document read passes migrateDocument(). A write
 * that fails throws a LocalBilletError and leaves the stored state as it was; reads never throw.
 * Another tab's writes arrive through the storage event: `list` follows them, and
 * `changedElsewhere` tells an open editor.
 */
@Injectable({ providedIn: 'root' })
export class LocalBilletStore {
  private readonly entries = signal<readonly LocalBilletEntry[]>(readIndex());
  private readonly changes = new Subject<string | null>();

  /** Newest first. */
  readonly list = this.entries.asReadonly();

  /** A billet another tab saved or removed: its localId, or null when the storage was cleared. */
  readonly changedElsewhere = this.changes.asObservable();

  constructor() {
    const abort = new AbortController();
    inject(DestroyRef).onDestroy(() => abort.abort());
    inject(DOCUMENT).defaultView?.addEventListener(
      'storage',
      (event) => this.onStorage(event.key),
      { signal: abort.signal },
    );
  }

  /** Stores a new billet and answers its localId. */
  create(document: BilletDocument, templateId: TemplateId | null = null): string {
    const entries = readIndex();
    if (entries.length >= MAX_LOCAL_BILLETS)
      throw new LocalBilletError('LOCAL_BILLET_LIMIT_REACHED');
    const localId = newLocalId();
    write(docKey(localId), JSON.stringify(document));
    try {
      this.writeIndex([entryOf(localId, document, templateId), ...entries]);
    } catch (error) {
      removeKey(docKey(localId));
      throw error;
    }
    return localId;
  }

  /** The billet, migrated; null when it is not stored here or unreadable. */
  load(localId: string): BilletDocument | null {
    return readDocument(localId);
  }

  /** Writes the billet; one removed meanwhile (another tab) is stored again, within the limit. */
  save(localId: string, document: BilletDocument): void {
    const entries = readIndex();
    const known = entries.find((entry) => entry.localId === localId);
    if (!known && entries.length >= MAX_LOCAL_BILLETS) {
      throw new LocalBilletError('LOCAL_BILLET_LIMIT_REACHED');
    }
    write(docKey(localId), JSON.stringify(document));
    const others = entries.filter((entry) => entry.localId !== localId);
    this.writeIndex([entryOf(localId, document, known?.templateId ?? null), ...others]);
  }

  remove(localId: string): void {
    removeKey(docKey(localId));
    const entries = readIndex();
    this.writeIndex(entries.filter((entry) => entry.localId !== localId));
  }

  /** A copy under a new localId, optionally renamed; null when the billet is gone. */
  duplicate(localId: string, title?: string): string | null {
    const document = this.load(localId);
    if (!document) return null;
    const templateId = readIndex().find((entry) => entry.localId === localId)?.templateId ?? null;
    return this.create({ ...document, title: title ?? document.title }, templateId);
  }

  private writeIndex(entries: LocalBilletEntry[]): void {
    const sorted = entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    write(INDEX_KEY, JSON.stringify(sorted));
    this.entries.set(sorted);
  }

  private onStorage(key: string | null): void {
    if (key === null || key === INDEX_KEY) this.entries.set(readIndex());
    if (key === null) this.changes.next(null);
    else if (key.startsWith(DOC_KEY_PREFIX)) this.changes.next(key.slice(DOC_KEY_PREFIX.length));
  }
}

const docKey = (localId: string) => DOC_KEY_PREFIX + localId;

/** 48 random bits as hex: unique among 20 billets, and URL-safe. */
function newLocalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function entryOf(
  localId: string,
  { title, theme, scene }: BilletDocument,
  templateId: TemplateId | null,
): LocalBilletEntry {
  return {
    localId,
    title,
    theme,
    modelSlug: scene.enabled ? scene.modelSlug : null,
    templateId,
    updatedAt: new Date().toISOString(),
  };
}

function readDocument(localId: string): BilletDocument | null {
  const raw = read(docKey(localId));
  if (raw === null) return null;
  try {
    return migrateDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The stored index, newest first; malformed entries are skipped. A readable billet the index does
 * not list (an unreadable index, a malformed entry) is listed again from its document, so it is
 * never lost to the list; the next write stores its entry.
 */
function readIndex(): LocalBilletEntry[] {
  const listed = parseIndex();
  const known = new Set(listed.map((entry) => entry.localId));
  const recovered = storedLocalIds()
    .filter((localId) => !known.has(localId))
    .map((localId) => {
      const document = readDocument(localId);
      return document && entryOf(localId, document, null);
    })
    .filter((entry): entry is LocalBilletEntry => entry !== null);
  return [...listed, ...recovered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function parseIndex(): LocalBilletEntry[] {
  try {
    const parsed: unknown = JSON.parse(read(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function storedLocalIds(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    return Array.from({ length: store.length }, (_, i) => store.key(i) ?? '')
      .filter((key) => key.startsWith(DOC_KEY_PREFIX))
      .map((key) => key.slice(DOC_KEY_PREFIX.length));
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is LocalBilletEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const templateId = entry['templateId'];
  return (
    ['localId', 'title', 'theme', 'updatedAt'].every((key) => typeof entry[key] === 'string') &&
    (entry['modelSlug'] === null || typeof entry['modelSlug'] === 'string') &&
    (templateId === null || TEMPLATE_IDS.some((id) => id === templateId))
  );
}

// --- storage access: localStorage itself may throw (blocked site data, some private modes) --------

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  const store = storage();
  if (!store) throw new LocalBilletError('LOCAL_STORAGE_UNAVAILABLE');
  try {
    store.setItem(key, value);
  } catch (error) {
    throw new LocalBilletError(
      isQuotaError(error) ? 'LOCAL_STORAGE_FULL' : 'LOCAL_STORAGE_UNAVAILABLE',
    );
  }
}

function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to undo: a key that cannot be removed was never readable either.
  }
}

/** Firefox names it differently; old engines only set code 22. */
function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22)
  );
}
