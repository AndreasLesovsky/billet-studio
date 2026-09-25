package app.billetstudio.billet.document;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record Palettes(
    @NotNull @Valid BilletPalette light,
    @NotNull @Valid BilletPalette dark,
    @NotNull Boolean darkLinked) {
}
