package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class ValidationException extends ApiException {

    /**
     * @param logMessage
     *        which rule failed - server log only, the client gets the bare code
     */
    public ValidationException(String logMessage) {
        super("VALIDATION_ERROR", HttpStatus.BAD_REQUEST, logMessage);
    }
}
