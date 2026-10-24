import { Params } from '@angular/router';

import { BilletListQuery, BilletSortField } from '../../../core/services/admin-billet-api';
import { SortDirection } from '../../../core/services/admin-user-api';

const BILLET_PAGE_SIZE = 20;

const SORT_FIELDS: readonly BilletSortField[] = ['title', 'owner', 'createdAt', 'updatedAt'];
const DEFAULT_SORT: BilletSortField = 'updatedAt';

/**
 * The list's state lives in the URL (`?page=2&q=anna&published=true&sort=title&dir=asc`), like
 * the admin user list: every param is optional, a missing or broken one reads as its default, and
 * `page` is 1-based there, 0-based in the API.
 */
export interface BilletListParams {
  page?: string;
  q?: string;
  published?: string;
  sort?: string;
  dir?: string;
}

/** Dates newest first; titles and names read naturally A to Z. */
function defaultDirection(field: BilletSortField): SortDirection {
  return field === 'createdAt' || field === 'updatedAt' ? 'desc' : 'asc';
}

function isSortField(value: string | undefined): value is BilletSortField {
  return SORT_FIELDS.some((field) => field === value);
}

function parsePublished(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function parseBilletListQuery(params: BilletListParams): BilletListQuery {
  const page = Number(params.page);
  const sort = isSortField(params.sort) ? params.sort : DEFAULT_SORT;
  return {
    page: Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0,
    size: BILLET_PAGE_SIZE,
    q: params.q?.trim() ?? '',
    published: parsePublished(params.published),
    sort,
    direction: params.dir === 'asc' || params.dir === 'desc' ? params.dir : defaultDirection(sort),
  };
}

/** The URL of a query. Defaults are null, which the router drops, so the plain list stays bare. */
export function toQueryParams(query: BilletListQuery): Params {
  const defaultSort =
    query.sort === DEFAULT_SORT && query.direction === defaultDirection(DEFAULT_SORT);
  return {
    page: query.page > 0 ? query.page + 1 : null,
    q: query.q || null,
    published: query.published === null ? null : String(query.published),
    sort: defaultSort ? null : query.sort,
    dir: defaultSort ? null : query.direction,
  };
}

/** A click on a column header: the sorted column flips, another one starts in its natural order. */
export function sortedBy(query: BilletListQuery, field: BilletSortField): BilletListQuery {
  const flipped: SortDirection = query.direction === 'asc' ? 'desc' : 'asc';
  const direction = query.sort === field ? flipped : defaultDirection(field);
  return { ...query, page: 0, sort: field, direction };
}

/** The filter bar: the search text as typed and the status select ('' = both). */
export interface BilletFilterModel {
  q: string;
  published: string;
}

export function toFilterModel(query: BilletListQuery): BilletFilterModel {
  return { q: query.q, published: query.published === null ? '' : String(query.published) };
}

/** Whether the filter bar shows what the query already asks for. */
export function sameFilter(query: BilletListQuery, filter: BilletFilterModel): boolean {
  return query.q === filter.q.trim() && query.published === parsePublished(filter.published);
}

/** The query a filter change asks for; a new filter starts on its first page. */
export function filtered(query: BilletListQuery, filter: BilletFilterModel): BilletListQuery {
  return { ...query, page: 0, q: filter.q.trim(), published: parsePublished(filter.published) };
}
