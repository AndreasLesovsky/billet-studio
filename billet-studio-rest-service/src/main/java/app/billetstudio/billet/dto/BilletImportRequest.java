package app.billetstudio.billet.dto;

import java.util.List;

import app.billetstudio.billet.document.BilletDocument;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** The documents are validated by BilletService (schema version first), not by @Valid. */
public record BilletImportRequest(
    @NotNull @Size(min = 1, max = BilletImportRequest.MAX_DOCUMENTS) List<@NotNull BilletDocument> documents) {

    public static final int MAX_DOCUMENTS = 20;
}
