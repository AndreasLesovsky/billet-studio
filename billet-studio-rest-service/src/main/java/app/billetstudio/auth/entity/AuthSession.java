package app.billetstudio.auth.entity;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One login, as a row. While it exists and neither deadline has passed, its refresh token can mint access
 * tokens; delete it and the session is over - which is the whole reason it is stored at all. A signed token
 * can never be taken back, so logout, a password change and an absolute cap all need something the server
 * can remove.
 *
 * The raw token is never here, only its SHA-256 hash, exactly as {@link User#getResetTokenHash()} handles
 * password-reset tokens: a database dump must not hand out live sessions.
 */
@Entity
@Table(name = "tbl_auth_sessions")
@Getter
@Setter
@NoArgsConstructor
public class AuthSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(columnDefinition = "BIGINT UNSIGNED")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Moved forward on every refresh: "has anyone been here lately". */
    @Column(name = "idle_expires_at", nullable = false)
    private Instant idleExpiresAt;

    /** Written at login and never touched again, so activity cannot extend a session past its cap. */
    @Column(name = "absolute_expires_at", nullable = false)
    private Instant absoluteExpiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = Instant.now();
    }

    /** Whichever deadline falls first ends the session, so this is the only one anyone needs. */
    public Instant expiresAt() {
        return idleExpiresAt.isBefore(absoluteExpiresAt) ? idleExpiresAt : absoluteExpiresAt;
    }

    public boolean isExpiredAt(Instant moment) {
        return !expiresAt().isAfter(moment);
    }
}
