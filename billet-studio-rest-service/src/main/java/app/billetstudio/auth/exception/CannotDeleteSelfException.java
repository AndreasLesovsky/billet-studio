package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class CannotDeleteSelfException extends ApiException {

    public CannotDeleteSelfException() {
        super("CANNOT_DELETE_SELF", HttpStatus.FORBIDDEN);
    }
}
