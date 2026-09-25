import { describe, expect, it, vi } from 'vitest';

import { POST_LOGIN_ROUTE } from '../../core/services/auth-api';
import { postLoginTarget } from './post-login';

describe('postLoginTarget', () => {
  const owner = (belongs: boolean) => ({ returnUrlBelongsTo: vi.fn(() => belongs) });

  it('follows a safe returnUrl that belongs to the user signing in', () => {
    expect(postLoginTarget('/account', owner(true), 7)).toBe('/account');
  });

  it('lands on the billet list without a returnUrl', () => {
    expect(postLoginTarget(null, owner(true), 7)).toBe(POST_LOGIN_ROUTE);
  });

  it("drops the page another account's session ended on, asking with this user's id", () => {
    const authApi = owner(false);

    expect(postLoginTarget('/admin/users', authApi, 8)).toBe(POST_LOGIN_ROUTE);
    expect(authApi.returnUrlBelongsTo).toHaveBeenCalledWith('/admin/users', 8);
  });

  // Which URLs are unsafe is return-url.spec.ts's table.
  it('ignores an unsafe returnUrl without spending the return intent on it', () => {
    const authApi = owner(true);

    expect(postLoginTarget('//evil.example', authApi, 7)).toBe(POST_LOGIN_ROUTE);
    expect(authApi.returnUrlBelongsTo).not.toHaveBeenCalled();
  });
});
