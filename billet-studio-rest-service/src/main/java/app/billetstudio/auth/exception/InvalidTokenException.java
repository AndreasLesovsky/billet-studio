package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class InvalidTokenException extends ApiException {

    public InvalidTokenException() {
        super("INVALID_TOKEN", HttpStatus.BAD_REQUEST);
    }
}
