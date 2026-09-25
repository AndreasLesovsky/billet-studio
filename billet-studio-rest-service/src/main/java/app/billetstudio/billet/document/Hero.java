package app.billetstudio.billet.document;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record Hero(
    @NotNull @Size(max = 80) String label,
    @NotNull @Size(max = 60) String titleLine1,
    @NotNull @Size(max = 60) String titleLine2,
    @NotNull @Size(max = 120) String sub) {
}
