package app.billetstudio.billet.dto;

import java.time.Instant;

public record BilletSummaryDto(Long id, String title, String theme, String modelSlug, String previewUrl,
    boolean published, boolean hasUnpublishedChanges, String shareToken, Instant publishedAt, Instant createdAt,
    Instant updatedAt) {
}
