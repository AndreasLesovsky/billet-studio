package app.billetstudio.billet.document;

import app.billetstudio.billet.document.validation.NoControlCharacters;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record Signature(
    @NotNull @NoControlCharacters @Size(max = 60) String name,
    @NotNull @NoControlCharacters @Size(max = 120) String sub) {
}
