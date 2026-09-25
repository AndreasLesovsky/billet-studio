package app.billetstudio.shared.exception;

import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;

/**
 * Base of every domain exception. The subclass fixes errorCode and status, GlobalExceptionHandler turns
 * it into an {@link ApiError} - one handler for all of them. The message is for the server log only and
 * never reaches the client.
 */
public abstract class ApiException extends RuntimeException {

    private final String errorCode;
    private final HttpStatus status;

    protected ApiException(String errorCode, HttpStatus status) {
        this(errorCode, status, null);
    }

    protected ApiException(String errorCode, HttpStatus status, @Nullable String logMessage) {
        super(logMessage);
        this.errorCode = errorCode;
        this.status = status;
    }

    public String getErrorCode() { return errorCode; }

    public HttpStatus getStatus() { return status; }
}
