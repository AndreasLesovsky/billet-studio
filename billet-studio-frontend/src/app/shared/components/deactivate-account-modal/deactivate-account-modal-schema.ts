import { required, schema } from '@angular/forms/signals';

import {
  DeactivateAccountRequestDto,
  USER_DEACTIVATION_REASONS,
} from '../../../core/models/models';

/** The request with the reason as a select value: '' is "no answer". */
export type DeactivateAccountFormModel = Omit<DeactivateAccountRequestDto, 'reason'> & {
  reason: string;
};

export const EMPTY_MODEL: DeactivateAccountFormModel = { password: '', reason: '' };

export const deactivateAccountSchema = schema<DeactivateAccountFormModel>((p) => {
  required(p.password, { message: 'AUTH.CURRENT_PASSWORD_REQUIRED' });
});

/** Only a user-actor reason may travel; the backend rejects the admin ones from this side. */
export function toDeactivateDto(m: DeactivateAccountFormModel): DeactivateAccountRequestDto {
  const reason = USER_DEACTIVATION_REASONS.find((value) => value === m.reason);
  return { password: m.password, reason: reason ?? null };
}
