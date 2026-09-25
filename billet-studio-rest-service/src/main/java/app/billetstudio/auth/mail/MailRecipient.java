package app.billetstudio.auth.mail;

import app.billetstudio.auth.entity.User;

/**
 * What a mail needs to know about its recipient, copied out of the entity: mails are sent asynchronously and
 * after the transaction, where the row may be detached or already deleted.
 */
public record MailRecipient(String email, String name, String preferredLanguage) {

    public static MailRecipient of(User user) {
        return new MailRecipient(user.getEmail(), user.getName(), user.getPreferredLanguage());
    }
}
