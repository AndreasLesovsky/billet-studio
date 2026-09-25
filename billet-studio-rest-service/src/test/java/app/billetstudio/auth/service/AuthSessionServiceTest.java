package app.billetstudio.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.repository.AuthSessionRepository;
import app.billetstudio.shared.util.SecureTokens;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

/**
 * The deadline arithmetic of a session, with the clock positions a real database test cannot set up cheaply. What
 * real transactions do (two tabs at once, the absolute deadline under repeated refreshes, refusals whose deletes
 * must commit) is AuthSessionConcurrencyIT; login, logout and the lifetimes the shipped configuration gives are
 * AuthControllerIT.
 */
@ExtendWith(MockitoExtension.class)
class AuthSessionServiceTest {

    private static final Duration ADMIN_IDLE = Duration.ofMinutes(30);
    private static final Duration ADMIN_ABSOLUTE = Duration.ofHours(12);
    private static final Duration USER_IDLE = Duration.ofDays(14);
    private static final Duration USER_ABSOLUTE = Duration.ofDays(90);

    @Mock
    private AuthSessionRepository sessionRepository;

    private AuthSessionService service() {
        return new AuthSessionService(sessionRepository, ADMIN_IDLE, ADMIN_ABSOLUTE, USER_IDLE, USER_ABSOLUTE);
    }

    private static User user(long id, String role, boolean active) {
        User user = new User();
        user.setId(id);
        user.setActive(active);
        user.setRole(new Role(role.equals(Roles.ADMIN) ? 2L : 1L, role, null));
        return user;
    }

    /** Started, as startSession does, under the role the user has now: the cap is the login plus that role's cap. */
    private static AuthSession existingSession(User user, Instant idle, Instant absolute) {
        Duration cap = Roles.ADMIN.equals(user.getRole().getName()) ? ADMIN_ABSOLUTE : USER_ABSOLUTE;
        return existingSession(user, absolute.minus(cap), idle, absolute);
    }

    private static AuthSession existingSession(User user, Instant createdAt, Instant idle, Instant absolute) {
        AuthSession session = new AuthSession();
        session.setUser(user);
        session.setTokenHash("irrelevant-the-lookup-is-mocked");
        session.setIdleExpiresAt(idle);
        session.setAbsoluteExpiresAt(absolute);
        session.setCreatedAt(createdAt);
        return session;
    }

    /** A leaked database dump must not hand out live sessions. */
    @Test
    void startSession_storesTheHashAndNeverTheToken() {
        String rawToken = service().startSession(user(1L, Roles.USER, true)).rawToken();

        ArgumentCaptor<AuthSession> saved = ArgumentCaptor.forClass(AuthSession.class);
        verify(sessionRepository).save(saved.capture());
        assertThat(rawToken).isNotBlank();
        assertThat(saved.getValue().getTokenHash())
            .isEqualTo(SecureTokens.sha256Hex(rawToken))
            .isNotEqualTo(rawToken)
            .hasSize(64);
    }

    @Test
    void remainingFor_shrinksWithTheCapEvenWhileIdleIsHealthy() {
        // What the frontend counts down. Reading the idle window alone would promise 30 minutes to someone who
        // has 3 - the warning would arrive after the logout.
        AuthSession session = existingSession(user(1L, Roles.ADMIN, true),
            Instant.now().plus(ADMIN_IDLE), Instant.now().plus(Duration.ofMinutes(3)));

        assertThat(service().remainingFor(session)).isLessThan(Duration.ofMinutes(4));
    }

    @Test
    void refresh_slidesTheIdleDeadline() {
        User user = user(1L, Roles.USER, true);
        AuthSession session = existingSession(user,
            Instant.now().plus(Duration.ofDays(1)), Instant.now().plus(Duration.ofDays(80)));
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));

        service().refresh("some-token");

        assertThat(session.getIdleExpiresAt()).isAfter(Instant.now().plus(USER_IDLE).minus(Duration.ofMinutes(1)));
    }

    @Test
    void refresh_rejectsASessionPastItsCapEvenWhileActive() {
        // Idle is healthy, the cap is not. This is the case a sliding-only design cannot express.
        User user = user(1L, Roles.ADMIN, true);
        AuthSession session = existingSession(user,
            Instant.now().plus(Duration.ofMinutes(20)), Instant.now().minus(Duration.ofSeconds(1)));
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));

        assertThatThrownBy(() -> service().refresh("capped"))
            .isInstanceOf(JwtAuthException.class);
        verify(sessionRepository).deleteByTokenHash(SecureTokens.sha256Hex("capped"));
    }

    @Test
    void refresh_treatsARowDeletedMidFlightAsNoSession() {
        // Logout in another tab, a password change, a deactivation or the purge job can remove the row between
        // the read and the idle slide. Left to the commit that is an unhandled optimistic-lock failure -> 500, and
        // the frontend only ends the session on a 401: the user would sit there apparently logged in with a
        // session that no longer exists.
        User user = user(1L, Roles.ADMIN, true);
        AuthSession session = existingSession(user,
            Instant.now().plus(Duration.ofMinutes(10)), Instant.now().plus(Duration.ofHours(5)));
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));
        doThrow(new ObjectOptimisticLockingFailureException(AuthSession.class, 1L))
            .when(sessionRepository).flush();

        assertThatThrownBy(() -> service().refresh("token-of-a-row-that-just-went-away"))
            .isInstanceOf(JwtAuthException.class);
    }

    // ---------------------------------------------------------------- a role change mid-session

    /** Logged in as a user, promoted to admin since: the stored deadlines are still the user's. */
    private static AuthSession sessionOfAPromotedUser(Duration age) {
        Instant login = Instant.now().minus(age);
        return existingSession(user(1L, Roles.ADMIN, true), login, Instant.now().plus(Duration.ofDays(13)),
            login.plus(USER_ABSOLUTE));
    }

    @Test
    void refresh_appliesTheCurrentRoleNotTheOneFromLogin() {
        // Promoted to admin mid-session: the tighter idle window has to bite on the next refresh, not at the next
        // login, or a fresh admin keeps a 14-day session for two weeks.
        AuthSession session = sessionOfAPromotedUser(Duration.ofHours(1));
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));

        service().refresh("some-token");

        assertThat(session.getIdleExpiresAt()).isBefore(Instant.now().plus(Duration.ofHours(1)));
    }

    /**
     * The idle window alone let a promoted session run on to its 90-day user cap, 30 minutes at a time: a stolen user
     * cookie became a long-lived admin credential. The admin cap counts from the login, whatever the role was then.
     */
    @Test
    void refresh_endsAPromotedSessionThatIsAlreadyOlderThanTheAdminCap() {
        AuthSession session = sessionOfAPromotedUser(ADMIN_ABSOLUTE.plus(Duration.ofHours(1)));
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));

        assertThatThrownBy(() -> service().refresh("promoted"))
            .isInstanceOf(JwtAuthException.class);
        verify(sessionRepository).deleteByTokenHash(SecureTokens.sha256Hex("promoted"));
    }

    @Test
    void refresh_neverSlidesAPromotedSessionPastTheAdminCap() {
        AuthSession session = sessionOfAPromotedUser(ADMIN_ABSOLUTE.minus(Duration.ofMinutes(10)));
        Instant adminCap = session.getCreatedAt().plus(ADMIN_ABSOLUTE);
        when(sessionRepository.findByTokenHashWithUser(any())).thenReturn(Optional.of(session));

        service().refresh("some-token");

        assertThat(session.getIdleExpiresAt()).isEqualTo(adminCap);
        assertThat(session.getAbsoluteExpiresAt()).isEqualTo(session.getCreatedAt().plus(USER_ABSOLUTE));
        assertThat(service().remainingFor(session)).isLessThanOrEqualTo(Duration.ofMinutes(10));
    }
}
