package app.billetstudio.billet.document;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * One shape for every block type. The limits here are the widest over all types; the per-type rules (text length,
 * card-only and divider-only fields) are checked by the document-level {@code @ValidBilletDocument}.
 */
public record BilletBlock(
    @NotNull @Pattern(regexp = "^[a-z0-9-]{1,40}$") String id,
    @NotNull @Pattern(regexp = "^(paragraph|heading|card|note|divider)$") String type,
    @NotNull @Size(max = 2000) String text,
    @NotNull @Size(max = 16) String icon,
    @NotNull @Size(max = 120) String ariaLabel,
    @NotNull @Pattern(regexp = BilletDocument.DIVIDER_STYLE) String dividerStyle,
    @NotNull @Min(-6) @Max(6) Integer spaceAdjust) {
}
