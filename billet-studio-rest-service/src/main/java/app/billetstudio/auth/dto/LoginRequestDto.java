package app.billetstudio.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

// Format-only checks: a malformed request fails as 400 VALIDATION_ERROR without touching the account
// lookup, so no account state is leaked (auth failures stay a uniform 401).
public record LoginRequestDto(@NotBlank @Email String email, @NotBlank String password) {
}
