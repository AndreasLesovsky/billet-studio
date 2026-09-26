package app.billetstudio.billet.repository;

import java.time.Instant;

/** A list row without the two LONGTEXT documents; hasUnpublishedChanges is decided by the database. */
public record BilletSummaryRow(Long id, String title, String theme, String modelSlug, String shareToken,
    Instant publishedAt, Instant createdAt, Instant updatedAt, Boolean hasUnpublishedChanges) {

    /** published_at is non-null exactly when published_document is (chk_billets_published_pair). */
    public boolean published() {
        return publishedAt != null;
    }
}
