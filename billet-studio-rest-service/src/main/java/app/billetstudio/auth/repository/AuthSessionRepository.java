package app.billetstudio.auth.repository;

import java.time.Instant;
import java.util.Optional;

import app.billetstudio.auth.entity.AuthSession;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface AuthSessionRepository extends JpaRepository<AuthSession, Long> {

    /**
     * The lookup on every refresh. Fetches the user in the same statement: the refresh response carries name
     * and role, and the JWT holds only the subject, so that user is always needed.
     */
    @Query("SELECT s FROM AuthSession s JOIN FETCH s.user u JOIN FETCH u.role WHERE s.tokenHash = :hash")
    Optional<AuthSession> findByTokenHashWithUser(@Param("hash") String tokenHash);

    /** Logout: ends exactly this session, the other devices keep theirs. */
    @Modifying
    @Query("DELETE FROM AuthSession s WHERE s.tokenHash = :hash")
    int deleteByTokenHash(@Param("hash") String tokenHash);

    /** Password change, reset, deactivation, admin lock: everything this user holds stops working. */
    @Modifying
    @Query("DELETE FROM AuthSession s WHERE s.user.id = :userId")
    int deleteAllForUser(@Param("userId") Long userId);

    /**
     * Purge job. Either deadline being past is enough - a row is unusable once the first one falls, and
     * keeping it would only make the table grow.
     */
    @Modifying
    @Query("DELETE FROM AuthSession s WHERE s.idleExpiresAt < :cutoff OR s.absoluteExpiresAt < :cutoff")
    int deleteExpired(@Param("cutoff") Instant cutoff);
}
