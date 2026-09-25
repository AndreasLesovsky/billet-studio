import { hidden, maxLength, minLength, pattern, required, schema } from '@angular/forms/signals';

import {
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  maxUtf8Bytes,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  nonBlank,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
} from '../../../core/forms/signal-validators';
import { UserRequestDto, UserResponseDto } from '../../../core/models/models';
import { toAdminReason } from '../admin-reason';

/** The admin's user DTO with the lock reason as a select value: '' is "no reason". */
export type UserFormModel = Omit<UserRequestDto, 'deactivationReason'> & {
  deactivationReason: string;
};

export const EMPTY_MODEL: UserFormModel = {
  name: '',
  email: '',
  password: '',
  role: 'ROLE_USER',
  preferredLanguage: 'de',
  active: true,
  deactivationReason: '',
};

/**
 * The password rules apply to what is typed; an empty password is the component's call (required
 * when creating, "keep the current one" when editing), so that rule is composed on top there.
 */
export const userSchema = schema<UserFormModel>((p) => {
  nonBlank(p.name, 'ADMIN_USERS.NAME_REQUIRED');
  maxLength(p.name, NAME_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });
  pattern(p.name, NAME_PATTERN, { message: 'AUTH.NAME_INVALID' });

  required(p.email, { message: 'ADMIN_USERS.EMAIL_REQUIRED' });
  pattern(p.email, EMAIL_PATTERN, { message: 'AUTH.EMAIL_INVALID' });
  maxLength(p.email, EMAIL_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });

  minLength(p.password, PASSWORD_MIN_LENGTH, { message: 'FORMS.MIN_LENGTH' });
  maxUtf8Bytes(p.password, PASSWORD_MAX_BYTES, 'AUTH.PASSWORD_TOO_LONG');
  pattern(p.password, PASSWORD_PATTERN, { message: 'AUTH.PASSWORD_REQUIREMENTS' });

  // A reason belongs to a lock; an active account has none.
  hidden(p.deactivationReason, ({ valueOf }) => valueOf(p.active));
});

/**
 * The editor's starting point for an existing account. A reason the user gave when deactivating
 * themselves is not one the admin may send, so it reads as "no reason" here.
 */
export function toUserFormModel(user: UserResponseDto): UserFormModel {
  return {
    name: user.name,
    email: user.email,
    password: '',
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    active: user.active,
    deactivationReason: toAdminReason(user.deactivationReason) ?? '',
  };
}

/** An empty password keeps the current one; an active account travels without a reason. */
export function toUserRequestDto(m: UserFormModel): UserRequestDto {
  return {
    name: m.name,
    email: m.email,
    password: m.password,
    role: m.role,
    preferredLanguage: m.preferredLanguage,
    active: m.active,
    deactivationReason: m.active ? null : toAdminReason(m.deactivationReason),
  };
}
