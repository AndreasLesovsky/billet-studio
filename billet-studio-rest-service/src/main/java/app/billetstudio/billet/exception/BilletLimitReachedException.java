package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class BilletLimitReachedException extends ApiException {

    /**
     * @param logMessage
     *        the count and the limit - server log only
     */
    public BilletLimitReachedException(String logMessage) {
        super("BILLET_LIMIT_REACHED", HttpStatus.CONFLICT, logMessage);
    }
}
