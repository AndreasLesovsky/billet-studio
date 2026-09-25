package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class PasswordMismatchException extends ApiException {

    public PasswordMismatchException() {
        super("PASSWORD_MISMATCH", HttpStatus.BAD_REQUEST);
    }
}
