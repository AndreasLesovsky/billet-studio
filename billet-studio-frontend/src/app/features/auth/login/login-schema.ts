import { email, required, schema } from '@angular/forms/signals';

import { LoginRequestDto } from '../../../core/models/loginRequestDto';
import { nonBlank } from '../../../core/forms/signal-validators';

/** The login DTO as it is; sent unchanged. */
export type LoginFormModel = Required<LoginRequestDto>;

export const EMPTY_MODEL: LoginFormModel = { email: '', password: '' };

// No password policy here: it is a sign-up and reset rule, and a login has to accept whatever
// credential is stored. Mirrors the backend, which checks @NotBlank only.
export const loginSchema = schema<LoginFormModel>((p) => {
  required(p.email, { message: 'AUTH.EMAIL_REQUIRED' });
  email(p.email, { message: 'AUTH.EMAIL_INVALID' });
  nonBlank(p.password, 'AUTH.PASSWORD_REQUIRED');
});
