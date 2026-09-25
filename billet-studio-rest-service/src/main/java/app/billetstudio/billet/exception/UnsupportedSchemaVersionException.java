package app.billetstudio.billet.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** The frontend migrates old documents before sending, so any other version is a client that is out of date. */
public class UnsupportedSchemaVersionException extends ApiException {

    /**
     * @param logMessage
     *        the version received - server log only
     */
    public UnsupportedSchemaVersionException(String logMessage) {
        super("UNSUPPORTED_SCHEMA_VERSION", HttpStatus.BAD_REQUEST, logMessage);
    }
}
