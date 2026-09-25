package app.billetstudio.billet.dto;

import java.time.Instant;

import app.billetstudio.billet.document.BilletDocument;
import app.billetstudio.catalog.dto.ModelDto;

public record PublicBilletDto(BilletDocument document, ModelDto model, Instant publishedAt) {
}
