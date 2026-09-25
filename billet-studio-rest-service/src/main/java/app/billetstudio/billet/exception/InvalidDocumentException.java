package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** A billet document that breaks a rule of billet-document.md, its size cap included. */
public class InvalidDocumentException extends ApiException {

    /**
     * @param logMessage
     *        which rules failed (paths and constraint messages, never content) - server log only
     */
    public InvalidDocumentException(String logMessage) {
        super("VALIDATION_ERROR", HttpStatus.BAD_REQUEST, logMessage);
    }
}
