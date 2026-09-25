package app.billetstudio.billet.document;

import app.billetstudio.billet.document.validation.MultipleOf;
import app.billetstudio.billet.document.validation.NoControlCharacters;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** modelSlug keeps its format even while the scene is disabled; it must exist in tbl_models only when enabled. */
public record Scene(
    @NotNull Boolean enabled,
    @NotNull @Pattern(regexp = "^[a-z0-9-]{1,60}$") String modelSlug,
    @NotNull @DecimalMin("15") @DecimalMax("40") @MultipleOf(0.25) Double height,
    @NotNull @DecimalMin("0.5") @DecimalMax("3.0") Double fitSize,
    @NotNull @DecimalMin("-1.0") @DecimalMax("1.0") Double yOffset,
    @NotNull @DecimalMin("0.2") @DecimalMax("2.0") Double exposure,
    @NotNull @DecimalMin("1.5") @DecimalMax("6.0") Double cameraDistance,
    @NotNull @DecimalMin("-1.0") @DecimalMax("2.0") Double cameraHeight,
    @NotNull Boolean autoRotate,
    @NotNull @DecimalMin("0") @DecimalMax("3") Double autoRotateSpeed,
    @NotNull @NoControlCharacters @Size(max = 120) String hint,
    @NotNull @NoControlCharacters @Size(max = 160) String ariaLabel) {
}
