package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class TokenExpiredException extends ApiException {

    public TokenExpiredException() {
        super("TOKEN_EXPIRED", HttpStatus.BAD_REQUEST);
    }
}
