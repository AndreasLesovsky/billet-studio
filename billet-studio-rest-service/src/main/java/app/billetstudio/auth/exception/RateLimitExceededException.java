package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class RateLimitExceededException extends ApiException {

    public RateLimitExceededException() {
        super("RATE_LIMIT_EXCEEDED", HttpStatus.TOO_MANY_REQUESTS);
    }
}
