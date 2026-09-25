package app.billetstudio.auth.event;

import java.time.Instant;

import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.repository.UserRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Sends account lifecycle emails AFTER the transaction has committed. Failures are logged but never propagate
 * back into the original transaction.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountEventListener {

    private final UserRepository userRepository;
    private final AuthMailer authMailer;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleAccountEvent(AccountEvent event) {
        try {
            switch (event) {
            case AccountEvent.Deactivated(Long userId, Instant deletionDate) -> userRepository.findById(userId)
                .ifPresentOrElse(user -> authMailer.sendAccountDeactivated(MailRecipient.of(user), deletionDate),
                    () -> log.warn("Deactivated event for unknown userId={}", userId));
            case AccountEvent.Reactivated(Long userId) -> userRepository.findById(userId)
                .ifPresentOrElse(user -> authMailer.sendAccountDeletionCancelled(MailRecipient.of(user)),
                    () -> log.warn("Reactivated event for unknown userId={}", userId));
            case AccountEvent.DeletedByScheduler(String email, String name, String preferredLanguage) -> authMailer
                .sendAccountDeleted(new MailRecipient(email, name, preferredLanguage));
            case AccountEvent.DeletedByAdmin(String email, String name, String preferredLanguage) -> authMailer
                .sendAccountDeletedByAdmin(new MailRecipient(email, name, preferredLanguage));
            }
        } catch (Exception e) {
            log.error("Failed to handle account event {}: {}", event.getClass().getSimpleName(), e.getMessage());
        }
    }
}
