package app.billetstudio.billet.entity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import app.billetstudio.auth.entity.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.OptimisticLock;

/**
 * A billet: the draft {@link #document} (autosave writes here) and the {@link #publishedDocument} snapshot the public
 * link serves. Both hold JSON written by BilletDocumentCodec only.
 *
 * {@link #version} counts draft revisions. Publishing state and updatedAt are excluded from it, so publish and
 * unpublish never invalidate the version an open editor holds (unpublish answers 204 without a new version).
 * That exclusion is why @DynamicUpdate is mandatory: autosave and publish write disjoint columns, and a full-row
 * UPDATE from an autosave that read the row before a publish committed would pass its version check and silently
 * write the old publishing state back.
 */
@Entity
@DynamicUpdate
@Table(name = "tbl_billets")
@Getter
@Setter
@NoArgsConstructor
public class Billet {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(columnDefinition = "BIGINT UNSIGNED")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** Copy of document.title for list queries. */
    @Column(nullable = false, length = 120)
    private String title;

    /** Copy of document.theme for list queries. */
    @Column(length = 40)
    private String theme;

    /** Copy of document.scene.modelSlug while the scene is enabled, else null. */
    @Column(name = "model_slug", length = 60)
    private String modelSlug;

    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String document;

    @OptimisticLock(excluded = true)
    @Column(name = "published_document", columnDefinition = "LONGTEXT")
    private String publishedDocument;

    @OptimisticLock(excluded = true)
    @Column(name = "share_token", length = 22, unique = true, columnDefinition = "CHAR(22)")
    private String shareToken;

    @OptimisticLock(excluded = true)
    @Column(name = "published_at")
    private Instant publishedAt;

    @Version
    @Column(nullable = false, columnDefinition = "BIGINT UNSIGNED")
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @OptimisticLock(excluded = true)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public boolean isPublished() { return publishedDocument != null; }

    /** Both sides come from BilletDocumentCodec, so string equality is content equality. */
    public boolean hasUnpublishedChanges() {
        return publishedDocument != null && !publishedDocument.equals(document);
    }

    /**
     * Whole seconds, as the DATETIME column keeps them (MySQL would round a fraction, MariaDB cut it): a timestamp in
     * a write response then equals the one a later read returns.
     */
    public static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.SECONDS);
    }

    @PrePersist
    protected void onCreate() {
        Instant now = now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = now();
    }
}
