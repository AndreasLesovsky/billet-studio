package app.billetstudio.assist.dto;

import jakarta.validation.constraints.NotNull;

/**
 * A start configuration as labels of the billet questionnaire (docs/assist.md), never KEEP or NOT_SUPPORTED. The
 * frontend turns it into the start params of /billets/new; BilletQuestionnaire checks every label of a request.
 */
public record AssistBilletDto(
    @NotNull String template,
    @NotNull String theme,
    @NotNull String particles,
    @NotNull String divider,
    @NotNull String colorMode,
    @NotNull String lang,
    @NotNull String model) {
}
