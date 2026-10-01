package app.billetstudio.assist.dto;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** The latest turns of the chat, oldest first; the last one is the user's new message. */
public record AssistRequest(
    @NotNull @Size(min = 1, max = AssistRequest.MAX_TURNS) List<@NotNull @Valid AssistTurnDto> conversation) {

    public static final int MAX_TURNS = 10;
}
