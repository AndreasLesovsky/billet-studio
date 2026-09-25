package app.billetstudio.billet.dto;

import java.time.Instant;

public record BilletSaveResponse(Long version, Instant updatedAt, boolean hasUnpublishedChanges) {
}
