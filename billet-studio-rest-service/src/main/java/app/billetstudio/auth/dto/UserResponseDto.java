package app.billetstudio.auth.dto;

import java.time.Instant;

import app.billetstudio.auth.enums.DeactivationReason;

public record UserResponseDto(Long id, String name, String email, String role, String preferredLanguage,
    String avatarUrl, boolean active, boolean protectedAccount, Instant deactivatedAt, Instant deletionScheduledAt,
    DeactivationReason deactivationReason, Instant createdAt, Instant updatedAt) {
}
