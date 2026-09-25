package app.billetstudio.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** The password rules are checked in UserService, after the mismatch check. */
public record ResetPasswordRequestDto(@NotBlank String token, @NotBlank String newPassword,
    @NotBlank String confirmPassword) {
}
