package app.billetstudio.auth.validation;

import java.nio.charset.StandardCharsets;

import org.jspecify.annotations.Nullable;

/**
 * Single source of truth for a NEW password (register, reset, change, admin set); login only requires
 * non-blank. Letter and digit classes are Unicode-aware, so the backend never rejects what a frontend check
 * with the same intent accepts. Mirrored by the frontend password validators.
 */
public final class PasswordRules {

    public static final int MIN_LENGTH = 8;

    /** BCrypt reads only the first 72 bytes; anything past them would silently not count. */
    public static final int MAX_BYTES = 72;

    private PasswordRules() {
    }

    public static boolean isValid(@Nullable String password) {
        if (password == null
            || password.codePointCount(0, password.length()) < MIN_LENGTH
            || !fitsBcrypt(password)) {
            return false;
        }
        return password.codePoints().anyMatch(Character::isLowerCase)
            && password.codePoints().anyMatch(Character::isUpperCase)
            && password.codePoints().anyMatch(Character::isDigit);
    }

    public static boolean fitsBcrypt(String password) {
        return password.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES;
    }
}
