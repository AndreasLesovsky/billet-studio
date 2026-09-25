package app.billetstudio.billet.document;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record BilletPalette(
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String accent,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String accentSoft,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String border,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String background,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String ink,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String inkSoft,
    @NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String surface) {
}
