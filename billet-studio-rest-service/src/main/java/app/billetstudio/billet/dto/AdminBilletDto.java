package app.billetstudio.billet.dto;

import java.time.Instant;

/**
 * A row of the admin overview of all billets. Read-only and deliberately without the document: the overview shows who
 * made what and whether it is shared, not the billet itself. shareToken is set only while the billet is published (a
 * draft keeps its token for the next publish, but has no public page).
 */
public record AdminBilletDto(Long id, String title, String theme, String modelSlug, boolean published,
    String shareToken, Instant publishedAt, Instant createdAt, Instant updatedAt, Owner owner) {

    /** active = false takes the owner's shared pages offline (see BilletRepository.findPublishedByShareToken). */
    public record Owner(Long id, String name, String email, boolean active) {
    }
}
