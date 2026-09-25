package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** Also another user's billet and an unknown or unpublished share token: the answer never tells them apart. */
public class BilletNotFoundException extends ApiException {

    public BilletNotFoundException() {
        super("BILLET_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
}
