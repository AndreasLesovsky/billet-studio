package app.billetstudio.billet.document;

import java.util.List;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record Particles(
    @NotNull Boolean enabled,
    @NotNull @Pattern(regexp = "^(petal|snowflake|leaf|confetti|heart)$") String shape,
    @NotNull @Size(min = 1, max = 8) List<@NotNull @Pattern(regexp = BilletDocument.HEX_COLOR) String> colors,
    @NotNull @Min(0) @Max(100) Integer density,
    @NotNull @DecimalMin("0.25") @DecimalMax("3") Double speed,
    @NotNull @DecimalMin("0.5") @DecimalMax("2") Double size) {
}
