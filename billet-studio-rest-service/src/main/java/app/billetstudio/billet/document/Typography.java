package app.billetstudio.billet.document;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record Typography(
    @NotNull @Valid FontRef title,
    @NotNull @Valid FontRef titleAccent,
    @NotNull @Valid FontRef heading,
    @NotNull @Valid FontRef body,
    @NotNull @Valid FontRef signature,
    @NotNull @Valid FontRef ui,
    @NotNull @Pattern(regexp = "^(inkSoft|accent)$") String emphasis) {
}
