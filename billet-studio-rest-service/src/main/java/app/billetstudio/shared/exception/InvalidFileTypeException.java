package app.billetstudio.shared.exception;

import org.springframework.http.HttpStatus;

/** An upload whose extension is not accepted, or whose bytes do not decode as an image. */
public class InvalidFileTypeException extends ApiException {

    /**
     * @param logMessage
     *        why the file was refused - server log only
     */
    public InvalidFileTypeException(String logMessage) {
        super("INVALID_FILE_TYPE", HttpStatus.BAD_REQUEST, logMessage);
    }
}
