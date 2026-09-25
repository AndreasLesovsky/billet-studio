package app.billetstudio.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.Instant;
import java.util.Optional;

import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.shared.storage.AvatarImageProcessor;
import app.billetstudio.shared.storage.FileStorageService;
import app.billetstudio.support.SimulatedTransaction;
import app.billetstudio.support.SynchronizingTransactionManager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.multipart.MultipartFile;

/**
 * Which avatar file survives a FAILED switch. The successful upload, replacement and removal (files on disk, row,
 * served URL) are AccountControllerIT; a failure there cannot be provoked on purpose.
 */
@ExtendWith(MockitoExtension.class)
class AccountServiceTest {

    private static final String OLD_URL = "/uploads/avatars/old.webp";
    private static final String NEW_URL = "/uploads/avatars/new.webp";
    private static final byte[] WEBP = {1, 2, 3};

    @Mock
    private UserRepository userRepository;
    @Mock
    private FileStorageService fileStorageService;
    @Mock
    private AvatarImageProcessor avatarImageProcessor;

    private final SynchronizingTransactionManager transactionManager = new SynchronizingTransactionManager();
    private final MultipartFile image = mock(MultipartFile.class);

    private AccountService accountService;

    @BeforeEach
    void setUp() {
        accountService = new AccountService(userRepository, fileStorageService, avatarImageProcessor,
            transactionManager);
    }

    private static User user(long id, String avatarUrl) {
        User user = new User();
        user.setId(id);
        user.setName("Andreas");
        user.setEmail("andreas@example.com");
        user.setPreferredLanguage("de");
        user.setAvatarUrl(avatarUrl);
        user.setRole(new Role(1L, Roles.USER, null));
        user.setCreatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        return user;
    }

    /**
     * The row still points at the old file, so that one stays; the new file would be an orphan and goes. A deleted
     * account (UserNotFoundException inside the switch) takes the same path.
     */
    @Test
    void updateAvatar_whenTheRowSwitchFails_deletesTheNewFileAndKeepsTheOld() throws IOException {
        when(avatarImageProcessor.processToWebp(image)).thenReturn(WEBP);
        when(fileStorageService.storeAvatar(WEBP, 7L)).thenReturn(NEW_URL);
        when(userRepository.findById(7L)).thenReturn(Optional.of(user(7L, OLD_URL)));
        when(userRepository.save(any())).thenThrow(new DataIntegrityViolationException("row went away"));

        assertThatThrownBy(() -> accountService.updateAvatar(7L, image))
            .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(transactionManager.rollbacks()).isEqualTo(1);
        verify(fileStorageService).delete(NEW_URL);
        verify(fileStorageService, never()).delete(OLD_URL);
    }

    /** The file goes only once the row no longer points at it; a rolled-back removal keeps a working avatar. */
    @Test
    void removeAvatar_rolledBack_keepsTheFile() {
        when(userRepository.findById(7L)).thenReturn(Optional.of(user(7L, OLD_URL)));
        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        try (SimulatedTransaction tx = SimulatedTransaction.begin()) {
            accountService.removeAvatar(7L);
            tx.rollback();
        }

        verifyNoInteractions(fileStorageService);
    }
}
