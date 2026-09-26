import { describe, expect, it } from 'vitest';

import { NOT_SHARED, publishBadgeOf, shareStateOf } from './share-state';

describe('shareStateOf', () => {
  const ORIGIN = 'https://billet.example/';
  const PUBLISHED = { published: true, hasUnpublishedChanges: false, shareToken: 'Ab-_12' };

  it('a private billet has no link; one shared before is told its old link comes back', () => {
    expect(shareStateOf(NOT_SHARED, ORIGIN)).toEqual({
      view: 'private',
      link: null,
      reshare: false,
    });
    expect(shareStateOf({ ...PUBLISHED, published: false }, ORIGIN)).toEqual({
      view: 'private',
      link: null,
      reshare: true,
    });
    expect(publishBadgeOf({ ...PUBLISHED, published: false })).toBeNull();
  });

  it('a published billet links to /b/<token>; edits since the snapshot make it "changed"', () => {
    expect(shareStateOf(PUBLISHED, ORIGIN)).toEqual({
      view: 'published',
      link: 'https://billet.example/b/Ab-_12',
      reshare: false,
    });
    expect(publishBadgeOf(PUBLISHED)?.key).toBe('SHARE.BADGE_PUBLISHED');

    const changed = { ...PUBLISHED, hasUnpublishedChanges: true };
    expect(shareStateOf(changed, ORIGIN).view).toBe('changed');
    expect(publishBadgeOf(changed)?.key).toBe('SHARE.BADGE_CHANGED');
  });
});
