package app.billetstudio.auth.validation;

import org.jspecify.annotations.Nullable;

/**
 * Single source of truth for the user 'name' field rule. 'name' is a free-form display name (nickname, first
 * name, or whatever the user chooses) - it is NOT a legal full name and is NOT unique; identity and uniqueness
 * rest solely on the email. Enforced on every write path (registration, admin create/update, account edit).
 * Mirrored by the frontend (NAME_PATTERN in core/forms/signal-validators.ts).
 */
public final class UserNameRules {

    public static final int MAX_LENGTH = 30;

    /** Unicode letters (incl. umlauts/accents) with single internal space, hyphen or apostrophe; no digits/symbols. */
    private static final String PATTERN = "^\\p{L}+(?:[ '\\-]\\p{L}+)*$";

    private UserNameRules() {
    }

    public static boolean isValid(@Nullable String name) {
        return name != null
            && !name.isBlank()
            && name.length() <= MAX_LENGTH
            && name.matches(PATTERN);
    }
}
