package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** An enabled scene names a slug that is not in tbl_models. */
public class UnknownModelException extends ApiException {

    /**
     * @param logMessage
     *        the slug - server log only
     */
    public UnknownModelException(String logMessage) {
        super("UNKNOWN_MODEL", HttpStatus.BAD_REQUEST, logMessage);
    }
}
