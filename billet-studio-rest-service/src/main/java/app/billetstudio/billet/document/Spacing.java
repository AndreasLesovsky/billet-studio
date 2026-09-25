package app.billetstudio.billet.document;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/** Every value is an index into BILLET_SPACE_SCALE (0..18). */
public record Spacing(
    @NotNull @Min(0) @Max(18) Integer gutter,
    @NotNull @Min(0) @Max(18) Integer heroTop,
    @NotNull @Min(0) @Max(18) Integer heroBottom,
    @NotNull @Min(0) @Max(18) Integer dividerGap,
    @NotNull @Min(0) @Max(18) Integer blockGap,
    @NotNull @Min(0) @Max(18) Integer signatureGap,
    @NotNull @Min(0) @Max(18) Integer pageBottom) {
}
