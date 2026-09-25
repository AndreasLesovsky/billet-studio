package app.billetstudio.auth.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import app.billetstudio.auth.entity.User;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByEmailAndIdNot(String email, Long id);

    Optional<User> findByResetTokenHash(String resetTokenHash);

    List<User> findByActiveFalseAndDeletionScheduledAtBefore(Instant cutoff);

    @Modifying
    @Query("UPDATE User u SET u.resetTokenHash = NULL, u.resetTokenExpiry = NULL "
        + "WHERE u.resetTokenExpiry IS NOT NULL AND u.resetTokenExpiry < :cutoff")
    int clearExpiredResetTokens(@Param("cutoff") Instant cutoff);

    /**
     * Admin list. likePattern is lowercased and already escaped with '!' (see UserService), or null for no
     * text filter; active null means both states.
     */
    @Query(value = "SELECT u FROM User u JOIN FETCH u.role r WHERE "
        + "(:likePattern IS NULL OR LOWER(u.name) LIKE :likePattern ESCAPE '!' "
        + "OR LOWER(u.email) LIKE :likePattern ESCAPE '!') "
        + "AND (:active IS NULL OR u.active = :active)", countQuery = "SELECT COUNT(u) FROM User u WHERE "
            + "(:likePattern IS NULL OR LOWER(u.name) LIKE :likePattern ESCAPE '!' "
            + "OR LOWER(u.email) LIKE :likePattern ESCAPE '!') "
            + "AND (:active IS NULL OR u.active = :active)")
    Page<User> searchAdmin(@Param("likePattern") String likePattern, @Param("active") Boolean active,
        Pageable pageable);

    /** Single-root enforcement: unprotect any row whose email is not the current ROOT_EMAIL. */
    @Modifying
    @Query("UPDATE User u SET u.protectedAccount = false "
        + "WHERE u.protectedAccount = true AND u.email <> :rootEmail")
    int demoteProtectedExcept(@Param("rootEmail") String rootEmail);
}
