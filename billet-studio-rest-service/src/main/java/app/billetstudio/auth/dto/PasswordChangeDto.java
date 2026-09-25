package app.billetstudio.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** The password rules (PasswordRules) are checked in UserService. */
public record PasswordChangeDto(@NotBlank String currentPassword, @NotBlank String newPassword,
    @NotBlank String confirmPassword) {
}
