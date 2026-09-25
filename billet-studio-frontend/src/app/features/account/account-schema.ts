import { maxLength, pattern, required, schema } from '@angular/forms/signals';

import { NAME_MAX_LENGTH, NAME_PATTERN, nonBlank } from '../../core/forms/signal-validators';
import { AccountDto, AccountUpdateDto, PasswordChangeDto } from '../../core/models/models';
import { newPasswordSchema } from '../auth/reset-password/reset-password-schema';

// The page runs two independent forms, so both empty values carry a qualifier.

/** The profile form IS the update DTO: both fields are required strings already. */
export type ProfileFormModel = Required<AccountUpdateDto>;

export const EMPTY_PROFILE_MODEL: ProfileFormModel = { name: '', preferredLanguage: '' };

export const profileSchema = schema<ProfileFormModel>((p) => {
  nonBlank(p.name, 'AUTH.NAME_REQUIRED');
  maxLength(p.name, NAME_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });
  pattern(p.name, NAME_PATTERN, { message: 'AUTH.NAME_INVALID' });
});

export function toProfileModel(account: AccountDto): ProfileFormModel {
  return { name: account.name, preferredLanguage: account.preferredLanguage };
}

export const EMPTY_PASSWORD_MODEL: PasswordChangeDto = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/** The reset link's rules, with the current password as the proof instead of the link. */
export const passwordChangeSchema = schema<PasswordChangeDto>((p) => {
  required(p.currentPassword, { message: 'AUTH.CURRENT_PASSWORD_REQUIRED' });
  newPasswordSchema(p);
});
