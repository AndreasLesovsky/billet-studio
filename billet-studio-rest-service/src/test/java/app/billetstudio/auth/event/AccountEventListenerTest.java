package app.billetstudio.auth.event;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.repository.UserRepository;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * The deactivated, reactivated and deleted-by-admin mails travel through the real listener in AccountControllerIT,
 * AuthControllerIT and UserControllerIT. What no IT reaches: the scheduler's deletion, which must mail from the event
 * alone (the row is gone), and a failure inside the listener, which runs after the commit.
 */
@ExtendWith(MockitoExtension.class)
class AccountEventListenerTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private AuthMailer authMailer;
    @InjectMocks
    private AccountEventListener listener;

    @Test
    void deletedBySchedulerSendsDeletedEmailFromEventData() {
        listener.handleAccountEvent(new AccountEvent.DeletedByScheduler("ada@example.de", "Ada", "de"));

        verify(authMailer).sendAccountDeleted(new MailRecipient("ada@example.de", "Ada", "de"));
        verifyNoInteractions(userRepository);
    }

    /** The account change has already committed when this runs; a failure must end here, logged, not as a 500. */
    @Test
    void aFailingMailerNeverEscapesTheListener() {
        doThrow(new IllegalStateException("smtp down")).when(authMailer).sendAccountDeleted(any());

        assertThatCode(() -> listener.handleAccountEvent(
            new AccountEvent.DeletedByScheduler("ada@example.de", "Ada", "de"))).doesNotThrowAnyException();
    }
}
