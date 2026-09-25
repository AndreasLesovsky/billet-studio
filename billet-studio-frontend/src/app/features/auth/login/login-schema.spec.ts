import { describe, expect, it } from 'vitest';

import { formFor } from '../../../../test-helpers';
import { EMPTY_MODEL, loginSchema } from './login-schema';

describe('loginSchema', () => {
  const build = () => formFor({ ...EMPTY_MODEL }, loginSchema);

  it('starts empty and invalid', () => {
    const { tree } = build();

    expect(tree().valid()).toBe(false);
    expect(tree.email().errors()[0]?.message).toBe('AUTH.EMAIL_REQUIRED');
    expect(tree.password().errors()[0]?.message).toBe('AUTH.PASSWORD_REQUIRED');
  });

  it('names a malformed address as such, not as missing', () => {
    const { model, tree } = build();
    model.update((m) => ({ ...m, email: 'anna' }));

    expect(tree.email().errors()[0]?.message).toBe('AUTH.EMAIL_INVALID');
  });

  it('refuses a password of spaces only', () => {
    const { model, tree } = build();
    model.set({ email: 'anna@example.com', password: '   ' });

    expect(tree.password().errors()[0]?.message).toBe('AUTH.PASSWORD_REQUIRED');
  });

  it('accepts any stored password: the sign-up policy is not a login rule', () => {
    const { model, tree } = build();
    model.set({ email: 'anna@example.com', password: 'x' });

    expect(tree().valid()).toBe(true);
  });
});
