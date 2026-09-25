package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class InvalidPasswordException extends ApiException {

    public InvalidPasswordException() {
        super("INVALID_PASSWORD", HttpStatus.BAD_REQUEST);
    }
}
