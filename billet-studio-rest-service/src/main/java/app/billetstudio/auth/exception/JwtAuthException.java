package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** Every authentication failure, whatever the cause - no account state leaks through the answer. */
public class JwtAuthException extends ApiException {

    public JwtAuthException() {
        super("UNAUTHORIZED", HttpStatus.UNAUTHORIZED);
    }
}
