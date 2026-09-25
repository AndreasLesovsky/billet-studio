package app.billetstudio.billet.dto;

import java.time.Instant;

public record PublishResponse(String shareToken, Instant publishedAt, Long version) {
}
