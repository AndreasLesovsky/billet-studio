package app.billetstudio.billet.document;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record Divider(@NotNull @Pattern(regexp = BilletDocument.DIVIDER_STYLE) String style) {
}
