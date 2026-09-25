package app.billetstudio.billet.dto;

import app.billetstudio.billet.document.BilletDocument;

import jakarta.validation.constraints.NotNull;

/** The document is validated by BilletService (schema version first), not by @Valid. */
public record BilletCreateRequest(@NotNull BilletDocument document) {
}
