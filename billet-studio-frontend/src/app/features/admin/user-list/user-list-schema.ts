import { Params } from '@angular/router';

import { SortDirection, UserListQuery, UserSortField } from '../../../core/services/admin-user-api';

export const USER_PAGE_SIZE = 20;

const SORT_FIELDS: readonly UserSortField[] = ['name', 'email', 'createdAt', 'role'];
const DEFAULT_SORT: UserSortField = 'createdAt';

/**
 * The list's state lives in the URL (`?page=2&q=anna&active=false&sort=name&dir=asc`), so a
 * reload, a shared link and the back button all show the same page. Every param is optional; a
 * missing or broken one reads as its default. `page` is 1-based there, 0-based in the API.
 */
export interface UserListParams {
  page?: string;
  q?: string;
  active?: string;
  sort?: string;
  dir?: string;
}

/** Newest accounts first; names and addresses read naturally A to Z. */
function defaultDirection(field: UserSortField): SortDirection {
  return field === 'createdAt' ? 'desc' : 'asc';
}

function isSortField(value: string | undefined): value is UserSortField {
  return SORT_FIELDS.some((field) => field === value);
}

function parseActive(value: string | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function parseUserListQuery(params: UserListParams): UserListQuery {
  const page = Number(params.page);
  const sort = isSortField(params.sort) ? params.sort : DEFAULT_SORT;
  return {
    page: Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0,
    size: USER_PAGE_SIZE,
    q: params.q?.trim() ?? '',
    active: parseActive(params.active),
    sort,
    direction: params.dir === 'asc' || params.dir === 'desc' ? params.dir : defaultDirection(sort),
  };
}

/** The URL of a query. Defaults are null, which the router drops, so the plain list stays bare. */
export function toQueryParams(query: UserListQuery): Params {
  const defaultSort =
    query.sort === DEFAULT_SORT && query.direction === defaultDirection(DEFAULT_SORT);
  return {
    page: query.page > 0 ? query.page + 1 : null,
    q: query.q || null,
    active: query.active === null ? null : String(query.active),
    sort: defaultSort ? null : query.sort,
    dir: defaultSort ? null : query.direction,
  };
}

/** A click on a column header: the sorted column flips, another one starts in its natural order. */
export function sortedBy(query: UserListQuery, field: UserSortField): UserListQuery {
  const flipped: SortDirection = query.direction === 'asc' ? 'desc' : 'asc';
  const direction = query.sort === field ? flipped : defaultDirection(field);
  return { ...query, page: 0, sort: field, direction };
}

/** The filter bar: the search text as typed and the status select ('' = both). */
export interface UserFilterModel {
  q: string;
  active: string;
}

export function toFilterModel(query: UserListQuery): UserFilterModel {
  return { q: query.q, active: query.active === null ? '' : String(query.active) };
}

/** Whether the filter bar shows what the query already asks for. */
export function sameFilter(query: UserListQuery, filter: UserFilterModel): boolean {
  return query.q === filter.q.trim() && query.active === parseActive(filter.active);
}

/** The query a filter change asks for; a new filter starts on its first page. */
export function filtered(query: UserListQuery, filter: UserFilterModel): UserListQuery {
  return { ...query, page: 0, q: filter.q.trim(), active: parseActive(filter.active) };
}
