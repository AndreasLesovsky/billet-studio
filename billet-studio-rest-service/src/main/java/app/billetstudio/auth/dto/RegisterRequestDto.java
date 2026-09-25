package app.billetstudio.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** Public sign-up; the role is always ROLE_USER. Name, email and password rules are checked in UserService. */
public record RegisterRequestDto(@NotBlank String name, @NotBlank String email, @NotBlank String password,
    String preferredLanguage) {
}
