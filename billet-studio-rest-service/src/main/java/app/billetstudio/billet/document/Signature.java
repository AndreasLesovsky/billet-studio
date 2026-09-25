package app.billetstudio.billet.document;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record Signature(
    @NotNull @Size(max = 60) String name,
    @NotNull @Size(max = 120) String sub) {
}
