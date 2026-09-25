package app.billetstudio.auth.entity;

import java.time.Instant;

import app.billetstudio.auth.enums.DeactivationReason;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Sessions (tbl_auth_sessions) and billets (tbl_billets) reference this row with ON DELETE CASCADE, so
 * deleting the user removes them in the database; nothing is mapped back from here.
 */
@Entity
@Table(name = "tbl_users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(columnDefinition = "BIGINT UNSIGNED")
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 150, unique = true)
    private String email;

    @Column(name = "preferred_language", nullable = false, length = 5)
    private String preferredLanguage = "de";

    @Column(name = "avatar_url", length = 500)
    private String avatarUrl;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "role_id", nullable = false)
    private Role role;

    @Column(name = "reset_token_hash", length = 64, unique = true)
    private String resetTokenHash;

    @Column(name = "reset_token_expiry")
    private Instant resetTokenExpiry;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "deactivated_at")
    private Instant deactivatedAt;

    @Column(name = "deletion_scheduled_at")
    private Instant deletionScheduledAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "deactivation_reason", length = 50)
    private DeactivationReason deactivationReason;

    // 'protected' is a Java keyword; only RootUserBootstrap ever sets this true.
    @Column(name = "is_protected", nullable = false)
    private boolean protectedAccount = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = Instant.now();
    }
}
