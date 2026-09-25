package app.billetstudio.shared.exception;

import java.time.Instant;

/**
 * The one error body of the API. Code only: the frontend maps errorCode to a localized message, so
 * nothing here is meant for a human reader.
 */
public record ApiError(String errorCode, int status, Instant timestamp) {

    public ApiError(String errorCode, int status) {
        this(errorCode, status, Instant.now());
    }
}
