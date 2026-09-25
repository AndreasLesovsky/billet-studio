import { describe, expect, it } from 'vitest';

import { UserListQuery } from '../../../core/services/admin-user-api';
import {
  filtered,
  parseUserListQuery,
  sameFilter,
  sortedBy,
  toFilterModel,
  toQueryParams,
  USER_PAGE_SIZE,
} from './user-list-schema';

const DEFAULT: UserListQuery = {
  page: 0,
  size: USER_PAGE_SIZE,
  q: '',
  active: null,
  sort: 'createdAt',
  direction: 'desc',
};

describe('user-list-schema', () => {
  it('a bare URL is the first page of all accounts, newest first, twenty per page', () => {
    expect(parseUserListQuery({})).toEqual({ ...DEFAULT, size: 20 });
  });

  it('reads every param, with the 1-based page of the URL as the 0-based page of the API', () => {
    expect(
      parseUserListQuery({ page: '3', q: ' anna ', active: 'false', sort: 'email', dir: 'desc' }),
    ).toEqual({ ...DEFAULT, page: 2, q: 'anna', active: false, sort: 'email', direction: 'desc' });
  });

  it.each([
    [{ page: '0' }, DEFAULT],
    [{ page: '-2' }, DEFAULT],
    [{ page: '1.5' }, DEFAULT],
    [{ page: 'two' }, DEFAULT],
    [{ active: 'maybe' }, DEFAULT],
    [{ sort: 'password' }, DEFAULT],
    [{ dir: 'sideways' }, DEFAULT],
  ])('a broken param %j reads as its default', (params, expected) => {
    expect(parseUserListQuery(params)).toEqual(expected);
  });

  it('a sort without a direction takes its natural one', () => {
    expect(parseUserListQuery({ sort: 'name' }).direction).toBe('asc');
    expect(parseUserListQuery({ sort: 'createdAt' }).direction).toBe('desc');
  });

  it('writes the defaults as nothing, so the plain list keeps a bare URL', () => {
    expect(toQueryParams(DEFAULT)).toEqual({
      page: null,
      q: null,
      active: null,
      sort: null,
      dir: null,
    });
  });

  it('writes a non-default query in the form it reads back', () => {
    const query: UserListQuery = {
      ...DEFAULT,
      page: 4,
      q: 'anna',
      active: true,
      sort: 'name',
      direction: 'desc',
    };

    const params = toQueryParams(query);

    expect(params).toEqual({ page: 5, q: 'anna', active: 'true', sort: 'name', dir: 'desc' });
    expect(
      parseUserListQuery({
        page: String(params['page']),
        q: params['q'],
        active: params['active'],
        sort: params['sort'],
        dir: params['dir'],
      }),
    ).toEqual(query);
  });

  it('a click on the sorted column flips it and starts on the first page', () => {
    const byName = { ...DEFAULT, page: 3, sort: 'name' as const, direction: 'asc' as const };

    expect(sortedBy(byName, 'name')).toEqual({ ...byName, page: 0, direction: 'desc' });
  });

  it('a click on another column sorts it in its natural order', () => {
    expect(sortedBy(DEFAULT, 'email')).toEqual({ ...DEFAULT, sort: 'email', direction: 'asc' });
    expect(sortedBy({ ...DEFAULT, sort: 'name', direction: 'asc' }, 'createdAt')).toEqual(DEFAULT);
  });

  it('a new filter starts on the first page and keeps the sort', () => {
    const query = { ...DEFAULT, page: 2, sort: 'name' as const, direction: 'asc' as const };

    expect(filtered(query, { q: ' berg ', active: 'true' })).toEqual({
      ...query,
      page: 0,
      q: 'berg',
      active: true,
    });
  });

  it('the filter bar shows the query, and knows when it still does', () => {
    const query = { ...DEFAULT, q: 'anna', active: false };

    expect(toFilterModel(query)).toEqual({ q: 'anna', active: 'false' });
    expect(sameFilter(query, { q: 'anna ', active: 'false' })).toBe(true);
    expect(sameFilter(query, { q: 'anna', active: '' })).toBe(false);
    expect(sameFilter(query, { q: 'ann', active: 'false' })).toBe(false);
  });
});
