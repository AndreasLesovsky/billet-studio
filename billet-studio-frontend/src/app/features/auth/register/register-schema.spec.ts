import { describe, expect, it } from 'vitest';

import { formFor } from '../../../../test-helpers';
import {
  RegisterFormModel,
  registerSchema,
  toRegisterDto,
  withUiLanguage,
} from './register-schema';

const VALID: RegisterFormModel = {
  name: 'Anna Berg',
  email: 'anna@example.com',
  password: 'Secret123',
  confirmPassword: 'Secret123',
  preferredLanguage: 'de',
};

describe('register-schema', () => {
  const build = (patch: Partial<RegisterFormModel> = {}) =>
    formFor<RegisterFormModel>({ ...VALID, ...patch }, registerSchema);

  it('accepts a complete sign-up', () => {
    expect(build().tree().valid()).toBe(true);
  });

  it.each([
    ['', 'AUTH.NAME_REQUIRED'],
    ['   ', 'AUTH.NAME_REQUIRED'],
    ['andi_99', 'AUTH.NAME_INVALID'],
    ['Max  Muster', 'AUTH.NAME_INVALID'],
    ['A'.repeat(31), 'FORMS.MAX_LENGTH'],
  ])('the name %j fails with %s', (name, key) => {
    expect(build({ name }).tree.name().errors()[0]?.message).toBe(key);
  });

  it.each([
    ['', 'AUTH.EMAIL_REQUIRED'],
    ['anna@example', 'AUTH.EMAIL_INVALID'],
    [`${'a'.repeat(140)}@example.com`, 'FORMS.MAX_LENGTH'],
  ])('the email %j fails with %s', (email, key) => {
    expect(build({ email }).tree.email().errors()[0]?.message).toBe(key);
  });

  // The field shows errors()[0]: the order is what the user reads.
  it.each([
    ['', 'AUTH.PASSWORD_REQUIRED'],
    ['Abc1', 'FORMS.MIN_LENGTH'],
    [`Aa1${'ä'.repeat(40)}`, 'AUTH.PASSWORD_TOO_LONG'],
    ['alllowercase', 'AUTH.PASSWORD_REQUIREMENTS'],
    ['NoDigitsHere', 'AUTH.PASSWORD_REQUIREMENTS'],
  ])('the password %j fails with %s', (password, key) => {
    const { tree } = build({ password, confirmPassword: password });
    expect(tree.password().errors()[0]?.message).toBe(key);
  });

  it('asks for the confirmation, then for it to match', () => {
    expect(build({ confirmPassword: '' }).tree.confirmPassword().errors()[0]?.message).toBe(
      'AUTH.PASSWORD_CONFIRM_REQUIRED',
    );
    expect(
      build({ confirmPassword: 'Secret124' }).tree.confirmPassword().errors()[0]?.message,
    ).toBe('AUTH.PASSWORD_MISMATCH');
  });

  it('re-checks the confirmation when the password changes', () => {
    const { model, tree } = build();
    model.update((m) => ({ ...m, password: 'Secret999' }));

    expect(tree.confirmPassword().valid()).toBe(false);
  });

  it('sends the DTO without the confirmation', () => {
    expect(toRegisterDto(VALID)).toEqual({
      name: 'Anna Berg',
      email: 'anna@example.com',
      password: 'Secret123',
      preferredLanguage: 'de',
    });
  });

  // Starting on the UI language and following the header is pinned by register.spec.ts.
  it('the language keeps a value picked in the form', () => {
    const picked = { ...VALID, preferredLanguage: 'en' };

    expect(withUiLanguage('en', { source: 'de', value: picked })).toBe(picked);
  });
});
