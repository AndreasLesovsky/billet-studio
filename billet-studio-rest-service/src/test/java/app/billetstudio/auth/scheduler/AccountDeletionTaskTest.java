package app.billetstudio.auth.scheduler;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.service.DeletionTrigger;
import app.billetstudio.auth.service.UserService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AccountDeletionTaskTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserService userService;
    @InjectMocks
    private AccountDeletionTask task;

    private static User user(long id) {
        User user = new User();
        user.setId(id);
        return user;
    }

    /** Each account is its own transaction: one that fails is retried next night, the others go now. */
    @Test
    void oneFailingDeletion_doesNotStopTheRest() {
        when(userRepository.findByActiveFalseAndDeletionScheduledAtBefore(any()))
            .thenReturn(List.of(user(1L), user(2L), user(3L)));
        doThrow(new IllegalStateException("row locked")).when(userService)
            .permanentlyDeleteUser(2L, DeletionTrigger.SCHEDULER);

        task.run();

        verify(userService).permanentlyDeleteUser(1L, DeletionTrigger.SCHEDULER);
        verify(userService).permanentlyDeleteUser(2L, DeletionTrigger.SCHEDULER);
        verify(userService).permanentlyDeleteUser(3L, DeletionTrigger.SCHEDULER);
    }
}
