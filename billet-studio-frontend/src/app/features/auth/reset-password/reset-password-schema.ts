import { minLength, pattern, required, schema, SchemaPath } from '@angular/forms/signals';

import { PasswordChangeDto } from '../../../core/models/passwordChangeDto';
import {
  maxUtf8Bytes,
  passwordMatch,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
} from '../../../core/forms/signal-validators';

/**
 * The body of POST /auth/reset-password without its token: a password change whose proof is the
 * link instead of the current password. The token comes from the URL, never from a field.
 */
export type ResetPasswordFormModel = Omit<PasswordChangeDto, 'currentPassword'>;

export const EMPTY_MODEL: ResetPasswordFormModel = { newPassword: '', confirmPassword: '' };

export interface NewPasswordPaths {
  newPassword: SchemaPath<string>;
  confirmPassword: SchemaPath<string>;
}

/** A new password and its confirmation: the reset here and the password change on the account page. */
export function newPasswordSchema(p: NewPasswordPaths): void {
  required(p.newPassword, { message: 'AUTH.NEW_PASSWORD_REQUIRED' });
  minLength(p.newPassword, PASSWORD_MIN_LENGTH, { message: 'FORMS.MIN_LENGTH' });
  maxUtf8Bytes(p.newPassword, PASSWORD_MAX_BYTES, 'AUTH.PASSWORD_TOO_LONG');
  pattern(p.newPassword, PASSWORD_PATTERN, { message: 'AUTH.PASSWORD_REQUIREMENTS' });

  required(p.confirmPassword, { message: 'AUTH.PASSWORD_CONFIRM_REQUIRED' });
  passwordMatch(p.newPassword, p.confirmPassword, 'AUTH.PASSWORD_MISMATCH');
}

export const resetPasswordSchema = schema<ResetPasswordFormModel>((p) => newPasswordSchema(p));
