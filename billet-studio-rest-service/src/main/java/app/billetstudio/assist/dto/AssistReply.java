package app.billetstudio.assist.dto;

import java.util.List;

/**
 * The billet after the new message, and what the frontend should say about it (ASSIST.NOTES.&lt;code&gt;): OFF_TOPIC,
 * NOTHING_RECOGNISED, NO_CHANGE, PARTICLES_NOT_SUPPORTED, MODEL_NOT_SUPPORTED.
 */
public record AssistReply(AssistBilletDto billet, List<String> notes) {
}
