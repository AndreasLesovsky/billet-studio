import { computed, inject, resource, Signal } from '@angular/core';

import { AssetCatalogApi } from '../services/asset-catalog-api';

/** The model catalog as preview cards need it: still loading, failed, or slug → preview URL. */
export type CatalogPreviews = 'loading' | 'failed' | ReadonlyMap<string, string>;

/** What an app-asset-thumb shows for one model. */
export interface ModelPreview {
  /** The preview image; null when there is none to show. */
  readonly src: string | null;
  /** The catalog is still loading: the thumb shimmers instead of showing its emoji. */
  readonly pending: boolean;
}

/**
 * One card's model preview. The emoji stands in only when there is nothing to wait for: the
 * catalog failed, it has no preview for the model, or the billet has no model.
 */
export function previewOf(catalog: CatalogPreviews, slug: string | null): ModelPreview {
  if (!slug || catalog === 'failed') return { src: null, pending: false };
  if (catalog === 'loading') return { src: null, pending: true };
  return { src: catalog.get(slug) || null, pending: false };
}

/**
 * The catalog's previews, from the caller's own resource over the session-cached catalog. Call in
 * an injection context.
 */
export function injectCatalogPreviews(): Signal<CatalogPreviews> {
  const catalog = inject(AssetCatalogApi);
  const library = resource({ loader: () => catalog.list() });
  return computed(() => {
    if (library.hasValue()) {
      return new Map(library.value().map((model) => [model.slug, model.previewUrl]));
    }
    return library.error() ? 'failed' : 'loading';
  });
}
