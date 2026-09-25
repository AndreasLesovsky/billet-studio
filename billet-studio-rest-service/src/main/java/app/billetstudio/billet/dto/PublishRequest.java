package app.billetstudio.billet.dto;

import jakarta.validation.constraints.NotNull;

public record PublishRequest(@NotNull Long version) {
}
