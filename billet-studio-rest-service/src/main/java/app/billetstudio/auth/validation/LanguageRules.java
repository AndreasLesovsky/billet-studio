package app.billetstudio.auth.validation;

import java.util.Set;

import org.jspecify.annotations.Nullable;

/**
 * The languages a user can choose for the UI and their mails. Mirrors tbl_users.chk_users_preferred_language
 * and the frontend's language list.
 */
public final class LanguageRules {

    public static final String DEFAULT = "de";

    private static final Set<String> SUPPORTED = Set.of("de", "en");

    private LanguageRules() {
    }

    public static boolean isSupported(@Nullable String language) {
        return language != null && SUPPORTED.contains(language);
    }

    /** The language to address someone in: theirs when supported, otherwise the default. */
    public static String orDefault(@Nullable String language) {
        return language != null && SUPPORTED.contains(language) ? language : DEFAULT;
    }
}
