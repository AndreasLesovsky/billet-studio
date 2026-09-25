package app.billetstudio.auth.service;

import java.time.Duration;
import java.time.Instant;

import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.repository.AuthSessionRepository;
import app.billetstudio.shared.util.SecureTokens;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Owns the lifetime of a login. The access token is signed and cannot be taken back; this is the half that
 * can, and every session is a row.
 *
 * No rotation: the refresh token is not single-use, so parallel tabs both succeed. Rotation with reuse
 * detection would cost a token family, a successor chain, a grace window and a row lock.
 */
@Slf4j
@Service
public class AuthSessionService {

    /** 256 bits. */
    private static final int TOKEN_BYTES = 32;

    private final AuthSessionRepository sessionRepository;

    // Values and their rationale live in application.yml, under app.auth.session.
    private final Duration adminIdle;
    private final Duration adminAbsolute;
    private final Duration userIdle;
    private final Duration userAbsolute;

    public AuthSessionService(
        AuthSessionRepository sessionRepository,
        @Value("${app.auth.session.admin.idle:30m}") Duration adminIdle,
        @Value("${app.auth.session.admin.absolute:12h}") Duration adminAbsolute,
        @Value("${app.auth.session.user.idle:14d}") Duration userIdle,
        @Value("${app.auth.session.user.absolute:90d}") Duration userAbsolute) {
        this.sessionRepository = sessionRepository;
        this.adminIdle = adminIdle;
        this.adminAbsolute = adminAbsolute;
        this.userIdle = userIdle;
        this.userAbsolute = userAbsolute;
    }

    /** The raw token is readable at this moment only; the row keeps nothing but its hash. */
    public record IssuedSession(String rawToken, AuthSession session) {
    }

    @Transactional
    public IssuedSession startSession(User user) {
        String rawToken = SecureTokens.urlSafeToken(TOKEN_BYTES);
        Instant now = Instant.now();

        AuthSession session = new AuthSession();
        session.setUser(user);
        session.setTokenHash(SecureTokens.sha256Hex(rawToken));
        session.setIdleExpiresAt(now.plus(idleFor(user)));
        session.setAbsoluteExpiresAt(now.plus(absoluteFor(user)));
        sessionRepository.save(session);

        log.info("Session started: userId={}", user.getId());
        return new IssuedSession(rawToken, session);
    }

    /**
     * Slides the idle deadline; the stored absolute one is never touched. Lifetimes are resolved per refresh, not
     * frozen at login: the current role's idle window applies, and so does its cap, counted from the login. A user
     * promoted to admin mid-session therefore keeps at most the admin cap - a session already older than that
     * ends at the next refresh.
     *
     * noRollbackFor: the dead rows removed on the way to a refusal must stay removed, or they keep answering
     * lookups until the purge job runs.
     *
     * @throws JwtAuthException
     *         for unknown, idled-out, capped-out and deactivated alike - no session state leaks.
     */
    @Transactional(noRollbackFor = JwtAuthException.class)
    public AuthSession refresh(String rawToken) {
        String tokenHash = SecureTokens.sha256Hex(rawToken);
        AuthSession session = sessionRepository.findByTokenHashWithUser(tokenHash)
            .orElseThrow(JwtAuthException::new);
        User user = session.getUser();
        Long userId = user.getId();

        Instant now = Instant.now();
        Instant roleCap = session.getCreatedAt().plus(absoluteFor(user));
        if (session.isExpiredAt(now) || !roleCap.isAfter(now)) {
            // Bulk delete, not delete(entity): a row a parallel request removed first must not fail the flush.
            sessionRepository.deleteByTokenHash(tokenHash);
            log.info("Session expired: userId={}", userId);
            throw new JwtAuthException();
        }

        if (!user.isActive()) {
            sessionRepository.deleteAllForUser(userId);
            log.warn("Session refused for a deactivated user: userId={}", userId);
            throw new JwtAuthException();
        }

        // Clamped rather than written into absolute_expires_at, so expiresAt() - the cookie age and the frontend's
        // countdown - and the purge job both see the role's cap.
        Instant idle = now.plus(idleFor(user));
        session.setIdleExpiresAt(idle.isBefore(roleCap) ? idle : roleCap);
        try {
            // Flushed here, not left to the commit: the row can be gone by now (logout in another tab,
            // password change, deactivation, purge), and at commit that surfaces as a 500 - which the
            // frontend reads as "the server hiccuped, the session lives on".
            sessionRepository.flush();
        } catch (ObjectOptimisticLockingFailureException e) {
            // The failed update must not be committed along with the refusal (noRollbackFor above).
            if (TransactionSynchronizationManager.isActualTransactionActive()) {
                TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
            }
            log.info("Session vanished during refresh: userId={}", userId);
            throw new JwtAuthException();
        }
        return session;
    }

    /** Logout. Ends exactly this session; the same account's other devices keep theirs. */
    @Transactional
    public void endSession(String rawToken) {
        sessionRepository.deleteByTokenHash(SecureTokens.sha256Hex(rawToken));
    }

    /** Password change, reset, deactivation, admin lock - a stolen session must not survive those. */
    @Transactional
    public int endAllSessions(Long userId) {
        int ended = sessionRepository.deleteAllForUser(userId);
        if (ended > 0) {
            log.info("All sessions ended: userId={}, count={}", userId, ended);
        }
        return ended;
    }

    /** Both the cookie's age and the deadline the frontend counts down. */
    public Duration remainingFor(AuthSession session) {
        return Duration.between(Instant.now(), session.expiresAt());
    }

    private boolean isAdmin(User user) {
        return user.getRole() != null && Roles.ADMIN.equals(user.getRole().getName());
    }

    private Duration idleFor(User user) {
        return isAdmin(user) ? adminIdle : userIdle;
    }

    private Duration absoluteFor(User user) {
        return isAdmin(user) ? adminAbsolute : userAbsolute;
    }
}
