package app.billetstudio.auth.dto;

import app.billetstudio.auth.enums.DeactivationReason;

import jakarta.validation.constraints.NotBlank;

public record DeactivateAccountRequestDto(@NotBlank String password, DeactivationReason reason) {
}
