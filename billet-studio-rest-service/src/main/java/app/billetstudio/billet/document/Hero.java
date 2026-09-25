package app.billetstudio.billet.document;

import app.billetstudio.billet.document.validation.NoControlCharacters;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record Hero(
    @NotNull @NoControlCharacters @Size(max = 80) String label,
    @NotNull @NoControlCharacters @Size(max = 60) String titleLine1,
    @NotNull @NoControlCharacters @Size(max = 60) String titleLine2,
    @NotNull @NoControlCharacters @Size(max = 120) String sub) {
}
