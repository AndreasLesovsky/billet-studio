package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class CannotDeactivateSelfException extends ApiException {

    public CannotDeactivateSelfException() {
        super("CANNOT_DEACTIVATE_SELF", HttpStatus.FORBIDDEN);
    }
}
