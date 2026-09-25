package app.billetstudio.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.stream.Stream;

import app.billetstudio.auth.dto.UserRequestDto;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.event.AccountEvent;
import app.billetstudio.auth.exception.CannotDeactivateSelfException;
import app.billetstudio.auth.exception.EmailAlreadyExistsException;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.exception.RootUserProtectedException;
import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.shared.storage.FileStorageService;
import app.billetstudio.shared.util.SecureTokens;
import app.billetstudio.support.SimulatedTransaction;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * The account rules no HTTP round trip can pin down cheaply: the BCrypt timing and byte limits, the reset token
 * itself, the guards that stop before anything is read, the admin-lock versus self-deactivation semantics of the
 * editor, and what survives a rollback. Every flow that works end to end - login, registration, reset, change,
 * deactivation, the admin round trip, root protection on the admin paths - is AuthControllerIT, AccountControllerIT
 * and UserControllerIT.
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    private static final String PASSWORD = "Longenough1";
    private static final Role USER_ROLE = new Role(1L, Roles.USER, null);
    private static final Role ADMIN_ROLE = new Role(2L, Roles.ADMIN, null);

    @Mock
    private UserRepository userRepository;
    @Mock
    private RoleRepository roleRepository;
    @Mock
    private AuthSessionService authSessionService;
    @Mock
    private BCryptPasswordEncoder passwordEncoder;
    @Mock
    private AuthMailer authMailer;
    @Mock
    private FileStorageService fileStorageService;
    @Mock
    private ApplicationEventPublisher eventPublisher;

    @InjectMocks
    private UserService userService;

    @BeforeEach
    void configure() {
        ReflectionTestUtils.setField(userService, "frontendUrl", "https://billet.example.com/");
    }

    private static UserRequestDto request(String name, String password, Boolean active, DeactivationReason reason) {
        return new UserRequestDto(name, "a@b.co", password, null, null, active, reason);
    }

    private static User user(long id, boolean active) {
        User user = new User();
        user.setId(id);
        user.setName("Max");
        user.setEmail("max" + id + "@example.com");
        user.setPreferredLanguage("de");
        user.setPasswordHash("hash");
        user.setRole(USER_ROLE);
        user.setActive(active);
        return user;
    }

    private static User protectedRoot() {
        User u = new User();
        u.setId(1L);
        u.setEmail("root@x.co");
        u.setName("Root");
        u.setPasswordHash("hash");
        u.setRole(ADMIN_ROLE);
        u.setActive(true);
        u.setProtectedAccount(true);
        return u;
    }

    private void saveAndFlushReturnsTheEntity() {
        when(userRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    // ============================================================ field rules on the write paths

    @ParameterizedTest
    @ValueSource(strings = {"plainaddress", "a b@c.de", "anne@example.c"})
    void rejectsMalformedEmails(String email) {
        UserRequestDto dto = new UserRequestDto("Anne", email, PASSWORD, null, null, null, null);

        assertThatThrownBy(() -> userService.createUser(dto)).isInstanceOf(ValidationException.class);
    }

    /** Reaching the duplicate check proves the address passed the format check. */
    @Test
    void acceptsPlusAddressesAndLongTopLevelDomains() {
        when(userRepository.existsByEmail("anne+billets@example.studio")).thenReturn(true);
        UserRequestDto dto = new UserRequestDto("Anne", "anne+billets@example.studio", PASSWORD, null, null, null,
            null);

        assertThatThrownBy(() -> userService.createUser(dto)).isInstanceOf(EmailAlreadyExistsException.class);
    }

    static Stream<Arguments> pathsThatSetAPassword() {
        return Stream.of(
            Arguments.of("reset link", (Consumer<UserService>) service -> service.resetPassword("tok", "weak",
                "weak")),
            Arguments.of("own change", (Consumer<UserService>) service -> service.changePassword(7L, "Current1",
                "weak", "weak")),
            Arguments.of("admin editor", (Consumer<UserService>) service -> service.updateUser(5L,
                request("Max", "weak", null, null), 9L)));
    }

    /** The rule itself is PasswordRulesTest; registration is AuthControllerIT. Every other path enforces it too. */
    @ParameterizedTest(name = "{0}")
    @MethodSource("pathsThatSetAPassword")
    void aWeakNewPassword_isRefusedBeforeAnythingIsRead(String path, Consumer<UserService> setsAWeakPassword) {
        assertThatThrownBy(() -> setsAWeakPassword.accept(userService)).isInstanceOf(ValidationException.class);
        verifyNoInteractions(userRepository, passwordEncoder);
    }

    // ============================================================ login

    /**
     * Timing: an unknown email must cost the same one BCrypt round as a known one, or the response time tells
     * which emails have an account. The compare runs against a real BCrypt hash, not a shortcut.
     */
    @Test
    void authenticate_unknownEmail_stillRunsExactlyOneBcryptCompare() {
        when(userRepository.findByEmail("ghost@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.authenticate("ghost@example.com", "Secret123"))
            .isInstanceOf(JwtAuthException.class);
        verify(passwordEncoder, times(1)).matches(eq("Secret123"),
            argThat(hash -> hash != null && hash.startsWith("$2") && hash.length() == 60));
    }

    /** BCrypt compares only 72 bytes, so a 73-byte guess that shares them would match. It must not log in. */
    @Test
    void authenticate_passwordOver72Bytes_isRefusedEvenWhenBcryptMatches() {
        String longGuess = "Aa1" + "x".repeat(70);
        User user = user(7L, true);
        when(userRepository.findByEmail("max7@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches(longGuess, "hash")).thenReturn(true);

        assertThatThrownBy(() -> userService.authenticate("max7@example.com", longGuess))
            .isInstanceOf(JwtAuthException.class);
    }

    // ============================================================ password reset

    /** 256 bits, one hour, and the database only ever sees the SHA-256; the raw token exists in the link alone. */
    @Test
    void requestPasswordReset_storesOnlyTheHash_andMailsTheLink() {
        User user = user(7L, true);
        when(userRepository.findByEmail("max7@example.com")).thenReturn(Optional.of(user));
        Instant before = Instant.now();

        userService.requestPasswordReset("max7@example.com");

        ArgumentCaptor<String> link = ArgumentCaptor.forClass(String.class);
        verify(authMailer).sendPasswordReset(eq(MailRecipient.of(user)), link.capture());
        assertThat(link.getValue()).startsWith("https://billet.example.com/reset-password?token=");
        String token = link.getValue().substring(link.getValue().indexOf("token=") + "token=".length());
        assertThat(token).hasSize(43).matches("[A-Za-z0-9_-]+");
        assertThat(user.getResetTokenHash()).isEqualTo(SecureTokens.sha256Hex(token)).isNotEqualTo(token);
        assertThat(user.getResetTokenExpiry()).isBetween(before.plus(Duration.ofMinutes(59)),
            Instant.now().plus(Duration.ofHours(1)));
        verify(userRepository).save(user);
    }

    /** No link is ever issued for the root (AuthControllerIT); should a token exist anyway, it opens nothing. */
    @Test
    void resetPassword_protectedRoot_isRefused() {
        when(userRepository.findByResetTokenHash(any())).thenReturn(Optional.of(protectedRoot()));
        assertThatThrownBy(() -> userService.resetPassword("tok", "Password1", "Password1"))
            .isInstanceOf(RootUserProtectedException.class);
    }

    // ============================================================ own account

    /** An open reset link is a second credential; it must not outlive the hash it could replace. */
    @Test
    void changePassword_setsTheHash_clearsAnOpenResetLink_andEndsEverySession() {
        User user = user(7L, true);
        user.setResetTokenHash("pending");
        user.setResetTokenExpiry(Instant.now().plus(Duration.ofMinutes(30)));
        when(userRepository.findById(7L)).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("Current1", "hash")).thenReturn(true);
        when(passwordEncoder.encode("Newpassword1")).thenReturn("new-hash");

        userService.changePassword(7L, "Current1", "Newpassword1", "Newpassword1");

        assertThat(user.getPasswordHash()).isEqualTo("new-hash");
        assertThat(user.getResetTokenHash()).isNull();
        assertThat(user.getResetTokenExpiry()).isNull();
        verify(userRepository).save(user);
        verify(authSessionService).endAllSessions(7L);
    }

    @Test
    void deactivateAccount_protectedRoot_isRefused() {
        when(userRepository.findById(1L)).thenReturn(Optional.of(protectedRoot()));
        assertThatThrownBy(() -> userService.deactivateAccount(1L, "pw", DeactivationReason.OTHER))
            .isInstanceOf(RootUserProtectedException.class);
    }

    // ============================================================ admin lock versus self-deactivation

    /**
     * The two sets never mix: an admin cannot claim a user's motive (the user side is AccountControllerIT). Rejected
     * before the user is even loaded, so nothing is written on the way out.
     */
    @Test
    void toggleActive_userReason_isRefused() {
        assertThatThrownBy(() -> userService.toggleActive(5L, 9L, DeactivationReason.TOO_COMPLICATED))
            .isInstanceOf(ValidationException.class);
        verify(userRepository, never()).findById(any());
    }

    /**
     * An admin lock sets no deletionScheduledAt, so the next login is refused: locking yourself is a one-way door.
     * The toggle refuses it (UserControllerIT); the editor writes `active` too and is the second door.
     */
    @Test
    void updateUser_deactivatingSelf_isRefused() {
        assertThatThrownBy(() -> userService.updateUser(5L, request("Max", PASSWORD, false, null), 5L))
            .isInstanceOf(CannotDeactivateSelfException.class);
        verify(userRepository, never()).findById(any());
        verify(userRepository, never()).saveAndFlush(any());
    }

    /** Same as resetPassword and changePassword: the new hash must not leave an open reset link behind. */
    @Test
    void updateUser_withANewPassword_clearsAPendingResetToken() {
        User target = user(5L, true);
        target.setResetTokenHash("pending-hash");
        target.setResetTokenExpiry(Instant.now().plusSeconds(3600));
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));
        saveAndFlushReturnsTheEntity();

        userService.updateUser(5L, request("Max", PASSWORD, null, null), 9L);

        assertThat(target.getResetTokenHash()).isNull();
        assertThat(target.getResetTokenExpiry()).isNull();
    }

    /** The editor's lock ends the sessions like the toggle's does, or lifting it later would revive them. */
    @Test
    void updateUser_deactivating_endsEverySessionTheAccountHolds() {
        User target = user(5L, true);
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));
        saveAndFlushReturnsTheEntity();

        userService.updateUser(5L, request("Max", null, false, DeactivationReason.SPAM), 9L);

        assertThat(target.isActive()).isFalse();
        assertThat(target.getDeactivationReason()).isEqualTo(DeactivationReason.SPAM);
        verify(authSessionService).endAllSessions(5L);
    }

    private static User selfDeactivated(long id) {
        User user = user(id, false);
        user.setDeactivatedAt(Instant.now().minus(Duration.ofDays(2)));
        user.setDeletionScheduledAt(Instant.now().plus(Duration.ofDays(28)));
        user.setDeactivationReason(DeactivationReason.PRIVACY_CONCERNS);
        return user;
    }

    /**
     * The editor only overwrote the reason and left deletionScheduledAt, which authenticate() reads as "may
     * reactivate": the owner's next login inside the grace period undid the admin's FRAUD lock and cleared its
     * reason. toggleActive never had this hole.
     */
    @Test
    void updateUser_lockingASelfDeactivatedAccount_isALockTheOwnersLoginCannotLift() {
        User target = selfDeactivated(5L);
        Instant deactivatedAt = target.getDeactivatedAt();
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));
        saveAndFlushReturnsTheEntity();

        userService.updateUser(5L, request("Max", null, false, DeactivationReason.FRAUD), 9L);

        assertThat(target.getDeletionScheduledAt()).isNull();
        assertThat(target.getDeactivationReason()).isEqualTo(DeactivationReason.FRAUD);
        assertThat(target.getDeactivatedAt()).isEqualTo(deactivatedAt);

        when(userRepository.findByEmail(target.getEmail())).thenReturn(Optional.of(target));
        when(passwordEncoder.matches("Secret123", "hash")).thenReturn(true);
        assertThatThrownBy(() -> userService.authenticate(target.getEmail(), "Secret123"))
            .isInstanceOf(JwtAuthException.class);
        assertThat(target.isActive()).isFalse();
        assertThat(target.getDeactivationReason()).isEqualTo(DeactivationReason.FRAUD);
    }

    // Saving the editor without choosing an admin reason is an edit of name/email, not a lock.
    @Test
    void updateUser_plainEditOfASelfDeactivatedAccount_keepsItsGracePeriodAndReason() {
        User target = selfDeactivated(5L);
        Instant deletion = target.getDeletionScheduledAt();
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));
        saveAndFlushReturnsTheEntity();

        userService.updateUser(5L, request("Moritz", null, false, null), 9L);

        assertThat(target.getName()).isEqualTo("Moritz");
        assertThat(target.isActive()).isFalse();
        assertThat(target.getDeletionScheduledAt()).isEqualTo(deletion);
        assertThat(target.getDeactivationReason()).isEqualTo(DeactivationReason.PRIVACY_CONCERNS);
    }

    // ============================================================ delete

    /** The avatar file goes after the commit (AccountControllerIT); a rolled-back delete keeps it. */
    @Test
    void deleteUser_rolledBack_keepsTheAvatarFile() {
        User target = user(5L, true);
        target.setAvatarUrl("/uploads/avatars/user_5.webp");
        when(userRepository.findById(5L)).thenReturn(Optional.of(target));

        try (SimulatedTransaction tx = SimulatedTransaction.begin()) {
            userService.deleteUser(5L, 9L);
            tx.rollback();
        }

        verifyNoInteractions(fileStorageService);
    }

    @Test
    void permanentlyDeleteUser_byTheScheduler_deletesADueAccount() {
        User due = user(5L, false);
        due.setDeletionScheduledAt(Instant.now().minus(Duration.ofHours(1)));
        when(userRepository.findById(5L)).thenReturn(Optional.of(due));

        userService.permanentlyDeleteUser(5L, DeletionTrigger.SCHEDULER);

        verify(userRepository).delete(due);
        verify(eventPublisher).publishEvent(new AccountEvent.DeletedByScheduler("max5@example.com", "Max", "de"));
    }

    /** The scheduler read its list earlier; a login in between reactivated the account and must win. */
    @Test
    void permanentlyDeleteUser_byTheScheduler_skipsAnAccountThatIsNoLongerDue() {
        User reactivated = user(5L, true);
        when(userRepository.findById(5L)).thenReturn(Optional.of(reactivated));

        userService.permanentlyDeleteUser(5L, DeletionTrigger.SCHEDULER);

        verify(userRepository, never()).delete(any());
        verifyNoInteractions(eventPublisher);
    }
}
