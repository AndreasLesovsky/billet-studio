package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** The client's version is stale: another tab or device saved in between. */
public class BilletModifiedElsewhereException extends ApiException {

    public BilletModifiedElsewhereException() {
        super("BILLET_MODIFIED_ELSEWHERE", HttpStatus.CONFLICT);
    }
}
