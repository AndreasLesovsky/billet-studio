import { describe, expect, it } from 'vitest';

import { parseBilletListQuery, sortedBy, toQueryParams } from './billet-list-schema';

describe('billet list query', () => {
  it('reads broken or missing params as the defaults: first page, newest change first', () => {
    expect(
      parseBilletListQuery({ page: '0', published: 'maybe', sort: 'document', dir: 'up' }),
    ).toEqual({
      page: 0,
      size: 20,
      q: '',
      published: null,
      sort: 'updatedAt',
      direction: 'desc',
    });
  });

  it('round-trips through the URL and leaves the defaults out of it', () => {
    const query = parseBilletListQuery({ page: '3', q: ' anna ', published: 'false' });

    expect(toQueryParams(query)).toEqual({
      page: 3,
      q: 'anna',
      published: 'false',
      sort: null,
      dir: null,
    });
  });

  it('a header click flips the sorted column and starts another in its natural order', () => {
    const byTitle = sortedBy(parseBilletListQuery({ page: '2' }), 'title');

    expect(byTitle).toMatchObject({ page: 0, sort: 'title', direction: 'asc' });
    expect(sortedBy(byTitle, 'title').direction).toBe('desc');
    expect(sortedBy(byTitle, 'createdAt').direction).toBe('desc');
  });
});
