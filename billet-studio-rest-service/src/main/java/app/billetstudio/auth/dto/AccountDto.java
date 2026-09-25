package app.billetstudio.auth.dto;

import java.time.Instant;

public record AccountDto(Long id, String name, String email, String role, String preferredLanguage,
    String avatarUrl, Instant createdAt) {
}
