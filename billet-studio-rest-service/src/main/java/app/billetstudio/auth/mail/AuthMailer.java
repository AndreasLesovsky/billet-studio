package app.billetstudio.auth.mail;

import java.time.Instant;

/**
 * The mails the auth flows send. Implementations must never throw into the caller: a mail is a side effect,
 * and a failed one must not undo the account change that triggered it.
 */
public interface AuthMailer {

    void sendWelcome(MailRecipient recipient);

    /**
     * @param resetLink
     *        the complete frontend link, raw token included
     */
    void sendPasswordReset(MailRecipient recipient, String resetLink);

    void sendAccountDeactivated(MailRecipient recipient, Instant deletionDate);

    void sendAccountDeletionCancelled(MailRecipient recipient);

    void sendAccountDeleted(MailRecipient recipient);

    void sendAccountDeletedByAdmin(MailRecipient recipient);
}
