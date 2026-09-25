package app.billetstudio.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** The name and language rules are checked in AccountService. */
public record AccountUpdateDto(@NotBlank String name, @NotBlank String preferredLanguage) {
}
