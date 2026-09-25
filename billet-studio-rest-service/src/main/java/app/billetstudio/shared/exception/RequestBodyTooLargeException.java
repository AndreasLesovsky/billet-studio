package app.billetstudio.shared.exception;

import java.io.IOException;

/**
 * Thrown while a size-limited request body is read, once it passes or declares more than the limit. It surfaces
 * wrapped in the HttpMessageNotReadableException of the body converter, which GlobalExceptionHandler answers with
 * VALIDATION_ERROR instead of MALFORMED_REQUEST. An IOException, because that is what a failing stream may throw.
 */
public class RequestBodyTooLargeException extends IOException {

    public RequestBodyTooLargeException(long limit) {
        super("Request body exceeds " + limit + " bytes");
    }
}
