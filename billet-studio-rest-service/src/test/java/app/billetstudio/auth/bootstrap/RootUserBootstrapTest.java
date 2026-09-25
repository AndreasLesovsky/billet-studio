package app.billetstudio.auth.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Stream;

import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.support.EnvExample;
import app.billetstudio.support.StandaloneMvc;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.ApplicationArguments;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class RootUserBootstrapTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private RoleRepository roleRepository;
    @Mock
    private BCryptPasswordEncoder passwordEncoder;

    private final ApplicationArguments args = mock(ApplicationArguments.class);

    private RootUserBootstrap bootstrap(String email, String password, String name, boolean enforce) {
        RootUserBootstrap b = new RootUserBootstrap(userRepository, roleRepository, passwordEncoder);
        ReflectionTestUtils.setField(b, "rootEmail", email);
        ReflectionTestUtils.setField(b, "rootPassword", password);
        ReflectionTestUtils.setField(b, "rootName", name);
        ReflectionTestUtils.setField(b, "enforceStrongSecrets", enforce);
        return b;
    }

    private static Role adminRole() {
        return new Role(2L, "ROLE_ADMIN", null);
    }

    /** Env values often arrive padded; the stored address is the trimmed one, and a blank name falls back. */
    @Test
    void createsProtectedRootWhenMissing() {
        when(userRepository.findByEmail("root@x.co")).thenReturn(Optional.empty());
        when(roleRepository.findByName("ROLE_ADMIN")).thenReturn(Optional.of(adminRole()));
        when(passwordEncoder.encode("supersecretpassword")).thenReturn("hashed");

        bootstrap("  root@x.co ", "supersecretpassword", "  ", false).run(args);

        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(saved.capture());
        User root = saved.getValue();
        assertThat(root.getEmail()).isEqualTo("root@x.co");
        assertThat(root.getName()).isEqualTo("Root");
        assertThat(root.isProtectedAccount()).isTrue();
        assertThat(root.isActive()).isTrue();
        assertThat(root.getPasswordHash()).isEqualTo("hashed");
        assertThat(root.getRole().getName()).isEqualTo("ROLE_ADMIN");
        verify(userRepository).demoteProtectedExcept("root@x.co");
    }

    @Test
    void reconcilesExistingProtectedRootFromEnv() {
        User existing = new User();
        existing.setId(9L);
        existing.setEmail("root@x.co");
        existing.setProtectedAccount(true);
        // Tampered state that must heal: locked, scheduled for deletion, with a reset link in flight.
        existing.setActive(false);
        existing.setDeactivatedAt(Instant.now());
        existing.setDeletionScheduledAt(Instant.now());
        existing.setDeactivationReason(DeactivationReason.SPAM);
        existing.setResetTokenHash("pending");
        existing.setResetTokenExpiry(Instant.now());
        when(userRepository.findByEmail("root@x.co")).thenReturn(Optional.of(existing));
        when(roleRepository.findByName("ROLE_ADMIN")).thenReturn(Optional.of(adminRole()));
        when(passwordEncoder.encode(anyString())).thenReturn("hashed");

        bootstrap("root@x.co", "supersecretpassword", "Root", false).run(args);

        assertThat(existing.isActive()).isTrue();
        assertThat(existing.getPasswordHash()).isEqualTo("hashed");
        assertThat(existing.getDeactivatedAt()).isNull();
        assertThat(existing.getDeletionScheduledAt()).isNull();
        assertThat(existing.getDeactivationReason()).isNull();
        assertThat(existing.getResetTokenHash()).isNull();
        assertThat(existing.getResetTokenExpiry()).isNull();
        verify(userRepository).save(existing);
    }

    @Test
    void refusesSilentTakeoverOfExistingNormalUser() {
        User normal = new User();
        normal.setId(3L);
        normal.setEmail("root@x.co");
        normal.setProtectedAccount(false);
        when(userRepository.findByEmail("root@x.co")).thenReturn(Optional.of(normal));

        assertThatThrownBy(() -> bootstrap("root@x.co", "supersecretpassword", "Root", false).run(args))
            .isInstanceOf(IllegalStateException.class);
        verify(userRepository, never()).save(any());
    }

    @Test
    void failsFastWhenPasswordWeakAndStrongSecretsEnforced() {
        assertThatThrownBy(() -> bootstrap("root@x.co", "short", "Root", true).run(args))
            .isInstanceOf(IllegalStateException.class);
        verify(userRepository, never()).save(any());
    }

    /**
     * The root address is public and so are these two passwords: a production copy of .env.example, or a forgotten
     * ROOT_PASSWORD, would bootstrap an ADMIN anyone can log in as. Both pass the length check, so only the
     * placeholder list stops them. Read from the files, so a changed placeholder fails here first.
     */
    @ParameterizedTest
    @MethodSource("inRepoPasswords")
    void failsFastOnEveryPasswordThatShipsInTheRepositoryWhenStrongSecretsEnforced(String password) {
        assertThat(password).as("passes the length check").hasSizeGreaterThanOrEqualTo(16);

        assertThatThrownBy(() -> bootstrap("root@x.co", password, "Root", true).run(args))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ships in the repository");
        verifyNoInteractions(passwordEncoder, userRepository);
    }

    static Stream<String> inRepoPasswords() {
        return Stream.of(StandaloneMvc.shippedConfiguration().getProperty("app.root.password"),
            EnvExample.value("ROOT_PASSWORD"));
    }

    /** A forgotten ROOT_EMAIL in production: the break-glass account would sit on an address nobody reads. */
    @ParameterizedTest
    @MethodSource("inRepoEmails")
    void failsFastOnTheEmailThatShipsInTheRepositoryWhenStrongSecretsEnforced(String email) {
        assertThatThrownBy(
            () -> bootstrap(" " + email.toUpperCase(Locale.ROOT) + " ", "a-real-high-entropy-root-password",
                "Root", true).run(args))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ROOT_EMAIL");
        verifyNoInteractions(passwordEncoder, userRepository);
    }

    static Stream<String> inRepoEmails() {
        return Stream.of(StandaloneMvc.shippedConfiguration().getProperty("app.root.email"),
            EnvExample.value("ROOT_EMAIL"));
    }

    /** 37 characters but 74 UTF-8 bytes: BCrypt.encode would throw at the first boot, so the guard names it. */
    @Test
    void failsFastWhenPasswordExceedsTheBcryptLimitInBytes() {
        String password = "ä".repeat(37);

        assertThatThrownBy(() -> bootstrap("root@x.co", password, "Root", false).run(args))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ROOT_PASSWORD")
            .hasMessageContaining("72");
        verifyNoInteractions(passwordEncoder, userRepository);
    }
}
