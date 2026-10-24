package app.billetstudio.billet.repository;

import java.time.Instant;

/** A row of the admin overview: the billet's list data and its owner, never either document. */
public record AdminBilletRow(Long id, String title, String theme, String modelSlug, String shareToken,
    Instant publishedAt, Instant createdAt, Instant updatedAt, Long ownerId, String ownerName, String ownerEmail,
    Boolean ownerActive) {

    /** published_at is non-null exactly when published_document is (chk_billets_published_pair). */
    public boolean published() {
        return publishedAt != null;
    }
}
