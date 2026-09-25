package app.billetstudio.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.repository.AuthSessionRepository;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.shared.util.SecureTokens;
import app.billetstudio.support.MariaDbITBase;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * What real transactions do to one session row - which no mock can answer.
 *
 * The claim that pays for leaving rotation out: two tabs may renew the same session at the same moment, and both
 * succeed. With rotation this is the hard case - one tab wins, the other presents a spent token and, without a grace
 * window, gets the whole family revoked. Without rotation there is nothing to race: a refresh moves one timestamp
 * forward. Stated as an invariant so that anyone who later adds rotation finds out here.
 *
 * And the other half: a refused refresh deletes the dead rows it found, and those deletes must commit although the
 * method ends in an exception (CommerceX rolled them back).
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(AuthSessionService.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class AuthSessionConcurrencyIT extends MariaDbITBase {

    @Autowired
    private AuthSessionService sessionService;
    @Autowired
    private AuthSessionRepository sessionRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private RoleRepository roleRepository;

    private User newUser() {
        User user = new User();
        user.setName("Concurrent");
        user.setEmail(uniqueEmail("sessions"));
        user.setPasswordHash("irrelevant-never-verified-here");
        user.setRole(roleRepository.findByName(Roles.USER).orElseThrow());
        user.setActive(true);
        return userRepository.save(user);
    }

    private AuthSession sessionOf(String rawToken) {
        return sessionRepository.findByTokenHashWithUser(SecureTokens.sha256Hex(rawToken)).orElseThrow();
    }

    @Test
    void twoTabsRefreshingTheSameSessionBothSucceed() throws Exception {
        User user = newUser();
        String token = sessionService.startSession(user).rawToken();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<AuthSession> refresh = () -> sessionService.refresh(token);
            List<Future<AuthSession>> results = pool.invokeAll(List.of(refresh, refresh));

            for (Future<AuthSession> result : results) {
                // get() rethrows whatever the thread threw, so a revoked or unknown session fails here.
                assertThat(result.get()).isNotNull();
            }
        } finally {
            pool.shutdownNow();
        }

        // And the session is still exactly one usable row - no successor, no orphan, nothing revoked.
        assertThat(sessionsOf(user)).isEqualTo(1);
        assertThat(sessionService.refresh(token)).isNotNull();
    }

    @Test
    void refreshingDoesNotPushTheAbsoluteDeadline() {
        // The other half of "no rotation is safe": repeated renewal must not buy extra lifetime.
        String token = sessionService.startSession(newUser()).rawToken();
        AuthSession session = sessionOf(token);
        Instant cap = session.getAbsoluteExpiresAt();

        sessionService.refresh(token);
        sessionService.refresh(token);

        AuthSession after = sessionOf(token);
        assertThat(after.getAbsoluteExpiresAt()).isEqualTo(cap);
        assertThat(after.getIdleExpiresAt()).isAfterOrEqualTo(session.getIdleExpiresAt());
        assertThat(Duration.between(after.getCreatedAt(), after.getAbsoluteExpiresAt()))
            .isLessThanOrEqualTo(Duration.ofDays(90).plusMinutes(1));
    }

    @Test
    void anIdledOutSession_staysDeletedAfterTheRefusal() {
        User user = newUser();
        String token = sessionService.startSession(user).rawToken();
        AuthSession session = sessionOf(token);
        session.setIdleExpiresAt(Instant.now().minus(Duration.ofMinutes(1)));
        sessionRepository.save(session);

        assertThatThrownBy(() -> sessionService.refresh(token)).isInstanceOf(JwtAuthException.class);

        assertThat(sessionsOf(user)).isZero();
    }

    @Test
    void aDeactivatedUser_losesEverySessionOnTheFirstRefusedRefresh() {
        User user = newUser();
        String laptop = sessionService.startSession(user).rawToken();
        sessionService.startSession(user);
        user.setActive(false);
        userRepository.save(user);

        assertThatThrownBy(() -> sessionService.refresh(laptop)).isInstanceOf(JwtAuthException.class);

        assertThat(sessionsOf(user)).isZero();
    }
}
