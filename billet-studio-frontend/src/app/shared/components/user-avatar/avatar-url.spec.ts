import { describe, expect, it } from 'vitest';

import { resolveAvatarUrl } from './avatar-url';

describe('resolveAvatarUrl', () => {
  const page = 'http://localhost:4200/account';

  it("serves a backend path from the REST service's origin", () => {
    expect(
      resolveAvatarUrl('/uploads/avatars/user_7.webp', 'http://localhost:8080/v1/', page),
    ).toBe('http://localhost:8080/uploads/avatars/user_7.webp');
  });

  it('uses this origin when the API itself is served relative to the app', () => {
    expect(resolveAvatarUrl('/uploads/avatars/a.webp', '/v1/', page)).toBe(
      'http://localhost:4200/uploads/avatars/a.webp',
    );
  });

  it('leaves an absolute URL alone', () => {
    expect(resolveAvatarUrl('https://cdn.example.com/a.webp', '/v1/', page)).toBe(
      'https://cdn.example.com/a.webp',
    );
  });

  it('keeps "no avatar" empty', () => {
    expect(resolveAvatarUrl(null)).toBe('');
    expect(resolveAvatarUrl('')).toBe('');
  });
});
