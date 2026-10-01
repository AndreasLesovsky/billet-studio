package app.billetstudio.assist.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/**
 * The assistant cannot answer: switched off, the model server unreachable or too slow, or its reply unusable. The
 * frontend falls back to choosing a template by hand.
 */
public class AssistUnavailableException extends ApiException {

    /**
     * @param logMessage
     *        why - server log only, never the user's message
     */
    public AssistUnavailableException(String logMessage) {
        super("ASSIST_UNAVAILABLE", HttpStatus.SERVICE_UNAVAILABLE, logMessage);
    }
}
