package app.billetstudio.assist.dto;

import app.billetstudio.billet.document.validation.NoControlCharacters;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.jspecify.annotations.Nullable;

/** One entry of the conversation: a user's message (content), or the billet the assistant offered (billet). */
public record AssistTurnDto(
    @NotNull @Pattern(regexp = "^(user|assistant)$") String role,
    @Nullable @NoControlCharacters @Size(min = 1, max = AssistTurnDto.MAX_MESSAGE_LENGTH) String content,
    @Nullable @Valid AssistBilletDto billet) {

    public static final int MAX_MESSAGE_LENGTH = 300;

    public boolean isUser() {
        return "user".equals(role);
    }
}
