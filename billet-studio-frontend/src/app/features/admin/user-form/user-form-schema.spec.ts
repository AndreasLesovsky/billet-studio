import { describe, expect, it } from 'vitest';

import { UserResponseDto } from '../../../core/models/models';
import { formFor } from '../../../../test-helpers';
import {
  EMPTY_MODEL,
  toUserFormModel,
  toUserRequestDto,
  UserFormModel,
  userSchema,
} from './user-form-schema';

const FILLED: UserFormModel = {
  ...EMPTY_MODEL,
  name: 'Berta Blum',
  email: 'berta@example.com',
};

const RESPONSE: UserResponseDto = {
  id: 20,
  name: 'Berta Blum',
  email: 'berta@example.com',
  role: 'ROLE_ADMIN',
  preferredLanguage: 'en',
  avatarUrl: null,
  active: false,
  protectedAccount: false,
  deactivatedAt: '2026-02-01T00:00:00Z',
  deletionScheduledAt: null,
  deactivationReason: 'FRAUD',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

describe('user-form-schema', () => {
  const build = (patch: Partial<UserFormModel> = {}) =>
    formFor<UserFormModel>({ ...FILLED, ...patch }, userSchema).tree;

  it("accepts an account without a password: whether one is needed is the page's call", () => {
    expect(build()().valid()).toBe(true);
  });

  it.each([
    ['name', { name: ' ' }, 'ADMIN_USERS.NAME_REQUIRED'],
    ['name', { name: 'R2D2' }, 'AUTH.NAME_INVALID'],
    ['email', { email: '' }, 'ADMIN_USERS.EMAIL_REQUIRED'],
    ['email', { email: 'berta@' }, 'AUTH.EMAIL_INVALID'],
    ['password', { password: 'Abc1' }, 'FORMS.MIN_LENGTH'],
    ['password', { password: 'lowercase1' }, 'AUTH.PASSWORD_REQUIREMENTS'],
  ] as const)('the %s in %j fails with %s', (field, patch, key) => {
    expect(build(patch)[field]().errors()[0]?.message).toBe(key);
  });

  it('asks for a lock reason only while the account is locked', () => {
    const { model, tree } = formFor<UserFormModel>({ ...FILLED }, userSchema);
    expect(tree.deactivationReason().hidden()).toBe(true);

    model.update((m) => ({ ...m, active: false }));

    expect(tree.deactivationReason().hidden()).toBe(false);
  });

  it('opens an account for editing with an empty password', () => {
    expect(toUserFormModel(RESPONSE)).toEqual({
      name: 'Berta Blum',
      email: 'berta@example.com',
      password: '',
      role: 'ROLE_ADMIN',
      preferredLanguage: 'en',
      active: false,
      deactivationReason: 'FRAUD',
    });
  });

  it("reads a reason the user gave themselves as none: it is not the admin's to send", () => {
    expect(
      toUserFormModel({ ...RESPONSE, deactivationReason: 'PRIVACY_CONCERNS' }).deactivationReason,
    ).toBe('');
  });

  it('sends an active account without a reason, whatever the select still holds', () => {
    expect(toUserRequestDto({ ...FILLED, active: true, deactivationReason: 'SPAM' })).toEqual({
      name: 'Berta Blum',
      email: 'berta@example.com',
      password: '',
      role: 'ROLE_USER',
      preferredLanguage: 'de',
      active: true,
      deactivationReason: null,
    });
  });

  it('sends a locked account with its admin reason, or none', () => {
    expect(
      toUserRequestDto({ ...FILLED, active: false, deactivationReason: 'SPAM' }).deactivationReason,
    ).toBe('SPAM');
    expect(
      toUserRequestDto({ ...FILLED, active: false, deactivationReason: '' }).deactivationReason,
    ).toBeNull();
  });
});
