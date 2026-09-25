import { describe, expect, it } from 'vitest';

import { PasswordChangeDto } from '../../core/models/models';
import { formFor } from '../../../test-helpers';
import {
  EMPTY_PASSWORD_MODEL,
  passwordChangeSchema,
  profileSchema,
  toProfileModel,
} from './account-schema';

const CHANGE: PasswordChangeDto = {
  currentPassword: 'whatever it was',
  newPassword: 'Secret123',
  confirmPassword: 'Secret123',
};

describe('account-schema', () => {
  const password = (patch: Partial<PasswordChangeDto> = {}) =>
    formFor<PasswordChangeDto>({ ...CHANGE, ...patch }, passwordChangeSchema).tree;

  it('seeds the profile from the account', () => {
    expect(
      toProfileModel({
        id: 7,
        name: 'Anna',
        email: 'anna@example.com',
        role: 'ROLE_USER',
        preferredLanguage: 'en',
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({ name: 'Anna', preferredLanguage: 'en' });
  });

  it.each([
    ['  ', 'AUTH.NAME_REQUIRED'],
    ['Anna2', 'AUTH.NAME_INVALID'],
    ['A'.repeat(31), 'FORMS.MAX_LENGTH'],
  ])('the profile name %j fails with %s', (name, key) => {
    const { tree } = formFor({ name, preferredLanguage: 'de' }, profileSchema);
    expect(tree.name().errors()[0]?.message).toBe(key);
  });

  it('accepts a complete password change', () => {
    expect(password()().valid()).toBe(true);
  });

  it('the empty change form is invalid and asks for the current password first', () => {
    const tree = formFor({ ...EMPTY_PASSWORD_MODEL }, passwordChangeSchema).tree;

    expect(tree().valid()).toBe(false);
    expect(tree.currentPassword().errors()[0]?.message).toBe('AUTH.CURRENT_PASSWORD_REQUIRED');
  });

  it('takes the current password as it is: the policy is for the new one', () => {
    expect(password({ currentPassword: 'x' }).currentPassword().valid()).toBe(true);
  });

  // The field shows errors()[0]: the order is what the user reads.
  it.each([
    ['', 'AUTH.NEW_PASSWORD_REQUIRED'],
    ['Abc1', 'FORMS.MIN_LENGTH'],
    [`Aa1${'€'.repeat(24)}`, 'AUTH.PASSWORD_TOO_LONG'],
    ['passwort', 'AUTH.PASSWORD_REQUIREMENTS'],
    ['PASSWORT1', 'AUTH.PASSWORD_REQUIREMENTS'],
  ])('the new password %j fails with %s', (newPassword, key) => {
    expect(
      password({ newPassword, confirmPassword: newPassword }).newPassword().errors()[0]?.message,
    ).toBe(key);
  });

  it('asks for the confirmation, then for it to match the new password', () => {
    expect(password({ confirmPassword: '' }).confirmPassword().errors()[0]?.message).toBe(
      'AUTH.PASSWORD_CONFIRM_REQUIRED',
    );
    expect(password({ confirmPassword: 'Secret124' }).confirmPassword().errors()[0]?.message).toBe(
      'AUTH.PASSWORD_MISMATCH',
    );
  });
});
