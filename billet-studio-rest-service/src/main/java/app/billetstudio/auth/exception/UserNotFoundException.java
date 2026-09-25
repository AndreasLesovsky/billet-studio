package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class UserNotFoundException extends ApiException {

    public UserNotFoundException() {
        super("USER_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
}
