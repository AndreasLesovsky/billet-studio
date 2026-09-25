import { SchemaPath, validate } from '@angular/forms/signals';

/**
 * Mirrors the backend UserNameRules: the display name is Unicode letters (incl. umlauts/accents) with
 * a single internal space, hyphen or apostrophe; no digits or symbols. Not unique (identity is the
 * email). Pair with maxLength(NAME_MAX_LENGTH); add nonBlank only where a name is mandatory.
 */
export const NAME_PATTERN = /^\p{L}+(?:[ '\-]\p{L}+)*$/u;
export const NAME_MAX_LENGTH = 30;

/** Mirrors UserService.validateUserInput (TLD 2-6 letters) within tbl_users.email VARCHAR(150). */
export const EMAIL_PATTERN = /^[\w.-]+@[\w.-]+\.[A-Za-z]{2,6}$/;
export const EMAIL_MAX_LENGTH = 150;

/**
 * The password rule of the API contract, for register, reset, change and the admin editor (login
 * only requires non-blank). The upper bound is BCrypt's 72 BYTES, not characters, so it needs
 * maxUtf8Bytes rather than maxLength. Keep the order below - the field shows errors()[0]:
 *
 *   required(p.password, { message: '...' });
 *   minLength(p.password, PASSWORD_MIN_LENGTH, { message: 'FORMS.MIN_LENGTH' });
 *   maxUtf8Bytes(p.password, PASSWORD_MAX_BYTES, 'AUTH.PASSWORD_TOO_LONG');
 *   pattern(p.password, PASSWORD_PATTERN, { message: 'AUTH.PASSWORD_REQUIREMENTS' });
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
/** At least one lowercase letter, one uppercase letter and one digit (ASCII, as the backend). */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

const utf8 = new TextEncoder();

/**
 * Rejects an empty OR whitespace-only string, mirroring the backend `@NotBlank`:
 * `nonBlank(p.name, 'AUTH.NAME_REQUIRED')`. The message is a translate key.
 */
export function nonBlank(path: SchemaPath<string>, message: string): void {
  validate(path, ({ value }) =>
    value().trim().length > 0 ? undefined : { kind: 'nonBlank', message },
  );
}

/**
 * Cross-field equality check for a password + confirmation pair. The error is attached to the
 * `confirm` field, so its own error slot shows the mismatch message:
 * `passwordMatch(p.newPassword, p.confirmPassword, 'AUTH.PASSWORD_MISMATCH')`.
 */
export function passwordMatch(
  password: SchemaPath<string>,
  confirm: SchemaPath<string>,
  message: string,
): void {
  validate(confirm, ({ value, valueOf }) =>
    value() === valueOf(password) ? undefined : { kind: 'passwordMismatch', message },
  );
}

/**
 * A length limit counted in UTF-8 bytes, for values the backend stores or hashes as bytes (BCrypt
 * reads at most 72). The error carries `maxBytes`, but a byte count means nothing to a user, so the
 * message should not print it. Empty is left to `required`.
 */
export function maxUtf8Bytes(path: SchemaPath<string>, max: number, message: string): void {
  validate(path, ({ value }) =>
    utf8.encode(value()).length <= max ? undefined : { kind: 'maxBytes', maxBytes: max, message },
  );
}
