package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class AccountAlreadyDeactivatedException extends ApiException {

    public AccountAlreadyDeactivatedException() {
        super("ACCOUNT_ALREADY_DEACTIVATED", HttpStatus.CONFLICT);
    }
}
