package app.billetstudio.billet.document;

import app.billetstudio.billet.document.validation.MultipleOf;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record FontRef(
    @NotNull @Pattern(regexp = "^[a-z0-9-]{1,40}$") String fontId,
    @NotNull @Min(100) @Max(900) @MultipleOf(100) Integer weight,
    @NotNull Boolean italic,
    @NotNull @DecimalMin("0.5") @DecimalMax("2.0") Double size) {
}
