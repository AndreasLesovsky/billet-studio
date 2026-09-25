import { maxLength, minLength, pattern, required, schema } from '@angular/forms/signals';

import { RegisterRequestDto } from '../../../core/models/registerRequestDto';
import {
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  maxUtf8Bytes,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  nonBlank,
  passwordMatch,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
} from '../../../core/forms/signal-validators';
import { Language } from '../../../core/services/language-service';

/** The sign-up DTO plus the confirmation, which never leaves the page. */
export type RegisterFormModel = RegisterRequestDto & { confirmPassword: string };

export const EMPTY_MODEL: RegisterFormModel = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  preferredLanguage: '',
};

export const registerSchema = schema<RegisterFormModel>((p) => {
  nonBlank(p.name, 'AUTH.NAME_REQUIRED');
  maxLength(p.name, NAME_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });
  pattern(p.name, NAME_PATTERN, { message: 'AUTH.NAME_INVALID' });

  required(p.email, { message: 'AUTH.EMAIL_REQUIRED' });
  pattern(p.email, EMAIL_PATTERN, { message: 'AUTH.EMAIL_INVALID' });
  maxLength(p.email, EMAIL_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });

  required(p.password, { message: 'AUTH.PASSWORD_REQUIRED' });
  minLength(p.password, PASSWORD_MIN_LENGTH, { message: 'FORMS.MIN_LENGTH' });
  maxUtf8Bytes(p.password, PASSWORD_MAX_BYTES, 'AUTH.PASSWORD_TOO_LONG');
  pattern(p.password, PASSWORD_PATTERN, { message: 'AUTH.PASSWORD_REQUIREMENTS' });

  required(p.confirmPassword, { message: 'AUTH.PASSWORD_CONFIRM_REQUIRED' });
  passwordMatch(p.password, p.confirmPassword, 'AUTH.PASSWORD_MISMATCH');
});

/**
 * The model once the UI language is `lang`. The language select starts on the UI language and
 * follows the header's switch until a language is picked here; everything typed stays.
 */
export function withUiLanguage(
  lang: Language,
  previous?: { source: Language; value: RegisterFormModel },
): RegisterFormModel {
  if (!previous) return { ...EMPTY_MODEL, preferredLanguage: lang };
  const picked = previous.value.preferredLanguage !== previous.source;
  return picked ? previous.value : { ...previous.value, preferredLanguage: lang };
}

export function toRegisterDto(m: RegisterFormModel): RegisterRequestDto {
  return {
    name: m.name,
    email: m.email,
    password: m.password,
    preferredLanguage: m.preferredLanguage,
  };
}
