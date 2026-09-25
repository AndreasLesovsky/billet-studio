import { email, required, schema } from '@angular/forms/signals';

import { LoginRequestDto } from '../../../core/models/loginRequestDto';

/** The body of POST /auth/forgot-password: the address the login uses. */
export type ForgotPasswordFormModel = Pick<LoginRequestDto, 'email'>;

export const EMPTY_MODEL: ForgotPasswordFormModel = { email: '' };

export const forgotPasswordSchema = schema<ForgotPasswordFormModel>((p) => {
  required(p.email, { message: 'AUTH.EMAIL_REQUIRED' });
  email(p.email, { message: 'AUTH.EMAIL_INVALID' });
});
