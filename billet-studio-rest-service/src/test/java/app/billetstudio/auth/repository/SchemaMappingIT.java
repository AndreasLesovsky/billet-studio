package app.billetstudio.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.shared.util.SecureTokens;
import app.billetstudio.support.MariaDbITBase;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.dao.DataIntegrityViolationException;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The entities against the DELIVERED schema (sql/schema.sql + seed_roles.sql), since Hibernate never creates or
 * validates it (ddl-auto: none). A renamed column, a missed NOT NULL or a timestamp written in local time shows up
 * here, not on the user's database. Each test runs in a transaction that is rolled back.
 */
@Testcontainers(disabledWithoutDocker = true)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class SchemaMappingIT extends MariaDbITBase {

    private static final DateTimeFormatter SQL_DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Autowired
    private UserRepository userRepository;
    @Autowired
    private RoleRepository roleRepository;
    @Autowired
    private AuthSessionRepository sessionRepository;
    @Autowired
    private EntityManager entityManager;

    private Role role(String name) {
        return roleRepository.findByName(name).orElseThrow();
    }

    private User newUser() {
        User user = new User();
        user.setName("Mapping");
        user.setEmail(uniqueEmail("mapping"));
        user.setPasswordHash("hash");
        user.setRole(role(Roles.USER));
        return user;
    }

    private AuthSession newSession(User user, Instant idle, Instant absolute) {
        AuthSession session = new AuthSession();
        session.setUser(user);
        session.setTokenHash(SecureTokens.sha256Hex(SecureTokens.urlSafeToken(32)));
        session.setIdleExpiresAt(idle);
        session.setAbsoluteExpiresAt(absolute);
        return sessionRepository.saveAndFlush(session);
    }

    private String storedAsText(String table, String column, Long id) {
        return jdbc().queryForObject("SELECT CAST(" + column + " AS CHAR) FROM " + table + " WHERE id = ?",
            String.class, id);
    }

    private long count(String sql, Object... args) {
        Long count = jdbc().queryForObject(sql, Long.class, args);
        return count != null ? count : 0;
    }

    @Test
    void everyUserColumnSurvivesARoundTrip() {
        Instant moment = Instant.parse("2026-03-04T05:06:07Z");
        User user = newUser();
        user.setName("Jürgen Müller-Łukasz");
        user.setPreferredLanguage("en");
        user.setAvatarUrl("/uploads/avatars/user_1_1_1.webp");
        user.setRole(role(Roles.ADMIN));
        user.setResetTokenHash(SecureTokens.sha256Hex("reset"));
        user.setResetTokenExpiry(moment);
        user.setActive(false);
        user.setDeactivatedAt(moment);
        user.setDeletionScheduledAt(moment.plus(Duration.ofDays(30)));
        user.setDeactivationReason(DeactivationReason.PRIVACY_CONCERNS);
        user.setProtectedAccount(true);
        Long id = userRepository.saveAndFlush(user).getId();
        entityManager.clear();

        User read = userRepository.findById(id).orElseThrow();

        assertThat(read.getName()).isEqualTo("Jürgen Müller-Łukasz");
        assertThat(read.getEmail()).isEqualTo(user.getEmail());
        assertThat(read.getPreferredLanguage()).isEqualTo("en");
        assertThat(read.getAvatarUrl()).isEqualTo("/uploads/avatars/user_1_1_1.webp");
        assertThat(read.getPasswordHash()).isEqualTo("hash");
        assertThat(read.getRole().getName()).isEqualTo(Roles.ADMIN);
        assertThat(read.getResetTokenHash()).isEqualTo(SecureTokens.sha256Hex("reset"));
        assertThat(read.getResetTokenExpiry()).isEqualTo(moment);
        assertThat(read.isActive()).isFalse();
        assertThat(read.getDeactivatedAt()).isEqualTo(moment);
        assertThat(read.getDeletionScheduledAt()).isEqualTo(moment.plus(Duration.ofDays(30)));
        assertThat(read.getDeactivationReason()).isEqualTo(DeactivationReason.PRIVACY_CONCERNS);
        assertThat(read.isProtectedAccount()).isTrue();
        assertThat(read.getCreatedAt()).isNotNull();
        assertThat(read.getUpdatedAt()).isNotNull();
    }

    /** DATETIME holds the UTC wall clock whatever the JVM's zone (hibernate.jdbc.time_zone = UTC). */
    @Test
    void instantsAreStoredAsTheUtcWallClock() {
        User user = newUser();
        user.setDeactivatedAt(Instant.parse("2026-03-04T05:06:07Z"));
        Long id = userRepository.saveAndFlush(user).getId();

        assertThat(storedAsText("tbl_users", "deactivated_at", id)).isEqualTo("2026-03-04 05:06:07");
        Instant createdAt = LocalDateTime.parse(storedAsText("tbl_users", "created_at", id), SQL_DATETIME)
            .toInstant(ZoneOffset.UTC);
        assertThat(Duration.between(createdAt, user.getCreatedAt()).abs()).isLessThan(Duration.ofSeconds(2));
    }

    /** The one guard behind every write path's language check; the mail template is chosen by this value. */
    @Test
    void theDatabaseRefusesAnUnsupportedLanguage() {
        User user = newUser();
        user.setPreferredLanguage("fr");

        assertThatThrownBy(() -> userRepository.saveAndFlush(user)).isInstanceOf(DataIntegrityViolationException.class);
    }

    /** The race UserService cannot close: two sign-ups with one address both pass existsByEmail. */
    @Test
    void theDatabaseRefusesASecondAccountWithTheSameEmail() {
        User first = newUser();
        userRepository.saveAndFlush(first);
        User second = newUser();
        second.setEmail(first.getEmail());

        assertThatThrownBy(() -> userRepository.saveAndFlush(second))
            .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Hard-delete removes only the user row; tbl_auth_sessions and tbl_billets follow through ON DELETE CASCADE. If a
     * mapping ever tried to delete or null them itself, or the constraint went missing, this is where it shows.
     */
    @Test
    void deletingAUserTakesItsSessionsAndBilletsWithIt() {
        User user = userRepository.saveAndFlush(newUser());
        newSession(user, Instant.now().plus(Duration.ofDays(1)), Instant.now().plus(Duration.ofDays(90)));
        jdbc().update("INSERT INTO tbl_billets (user_id, title, document, created_at, updated_at) "
            + "VALUES (?, 'Cascade', '{}', UTC_TIMESTAMP(), UTC_TIMESTAMP())", user.getId());
        assertThat(count("SELECT COUNT(*) FROM tbl_billets WHERE user_id = ?", user.getId())).isEqualTo(1);
        entityManager.clear();

        userRepository.delete(userRepository.findById(user.getId()).orElseThrow());
        userRepository.flush();

        assertThat(sessionsOf(user)).isZero();
        assertThat(count("SELECT COUNT(*) FROM tbl_billets WHERE user_id = ?", user.getId())).isZero();
    }

    // ---------------------------------------------------------------- the scheduler queries

    @Test
    void clearExpiredResetTokens_clearsOnlyExpiredOnes() {
        User expired = newUser();
        expired.setResetTokenHash(SecureTokens.sha256Hex("expired"));
        expired.setResetTokenExpiry(Instant.now().minus(Duration.ofHours(1)));
        User pending = newUser();
        pending.setResetTokenHash(SecureTokens.sha256Hex("pending"));
        pending.setResetTokenExpiry(Instant.now().plus(Duration.ofHours(1)));
        userRepository.saveAllAndFlush(List.of(expired, pending));

        assertThat(userRepository.clearExpiredResetTokens(Instant.now())).isGreaterThanOrEqualTo(1);
        entityManager.clear();

        assertThat(userRepository.findById(expired.getId()).orElseThrow().getResetTokenHash()).isNull();
        assertThat(userRepository.findById(pending.getId()).orElseThrow().getResetTokenHash()).isNotNull();
    }

    @Test
    void theDeletionQuery_findsOnlyInactiveAccountsPastTheirDate() {
        User due = newUser();
        due.setActive(false);
        due.setDeletionScheduledAt(Instant.now().minus(Duration.ofMinutes(1)));
        User notYet = newUser();
        notYet.setActive(false);
        notYet.setDeletionScheduledAt(Instant.now().plus(Duration.ofDays(1)));
        User lockedByAdmin = newUser();
        lockedByAdmin.setActive(false);
        userRepository.saveAllAndFlush(List.of(due, notYet, lockedByAdmin));

        List<Long> found = userRepository.findByActiveFalseAndDeletionScheduledAtBefore(Instant.now()).stream()
            .map(User::getId)
            .toList();

        assertThat(found).contains(due.getId()).doesNotContain(notYet.getId(), lockedByAdmin.getId());
    }

    @Test
    void deleteExpired_removesSessionsPastEitherDeadline_andKeepsLiveOnes() {
        User user = userRepository.saveAndFlush(newUser());
        Instant now = Instant.now();
        newSession(user, now.minus(Duration.ofDays(2)), now.plus(Duration.ofDays(80)));
        newSession(user, now.plus(Duration.ofDays(1)), now.minus(Duration.ofDays(2)));
        newSession(user, now.plus(Duration.ofDays(1)), now.plus(Duration.ofDays(80)));

        assertThat(sessionRepository.deleteExpired(now.minus(Duration.ofDays(1)))).isGreaterThanOrEqualTo(2);

        assertThat(sessionsOf(user)).isEqualTo(1);
    }

    @Test
    void demoteProtectedExcept_leavesOnlyTheCurrentRootProtected() {
        User stale = newUser();
        stale.setProtectedAccount(true);
        User current = newUser();
        current.setProtectedAccount(true);
        userRepository.saveAllAndFlush(List.of(stale, current));

        userRepository.demoteProtectedExcept(current.getEmail());
        entityManager.clear();

        assertThat(userRepository.findById(stale.getId()).orElseThrow().isProtectedAccount()).isFalse();
        assertThat(userRepository.findById(current.getId()).orElseThrow().isProtectedAccount()).isTrue();
    }
}
