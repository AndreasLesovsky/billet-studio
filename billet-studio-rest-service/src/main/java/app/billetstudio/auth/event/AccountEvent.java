package app.billetstudio.auth.event;

import java.time.Instant;

/**
 * Published after an account lifecycle change has committed; the listener sends emails as non-critical side
 * effects. Sealed so the listener switches exhaustively over the four variants without a default, and each
 * variant carries only its own fields. For the deleted-by variants the user row is already gone when the
 * AFTER_COMMIT listener fires, so the recipient data is embedded in the event itself.
 */
public sealed interface AccountEvent {

    record Deactivated(Long userId, Instant deletionDate) implements AccountEvent {
    }

    record Reactivated(Long userId) implements AccountEvent {
    }

    record DeletedByScheduler(String email, String name, String preferredLanguage) implements AccountEvent {
    }

    record DeletedByAdmin(String email, String name, String preferredLanguage) implements AccountEvent {
    }
}
