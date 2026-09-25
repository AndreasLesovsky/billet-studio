package app.billetstudio.billet.dto;

import java.time.Instant;

import app.billetstudio.billet.document.BilletDocument;
import app.billetstudio.catalog.dto.ModelDto;

public record BilletDetailDto(Long id, Long version, BilletDocument document, ModelDto model, boolean published,
    boolean hasUnpublishedChanges, String shareToken, Instant publishedAt, Instant createdAt, Instant updatedAt) {
}
