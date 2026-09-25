package app.billetstudio.shared.exception;

import org.springframework.http.HttpStatus;

/** An upload that arrived without content. */
public class FileUploadException extends ApiException {

    /**
     * @param logMessage
     *        what was wrong with the upload - server log only
     */
    public FileUploadException(String logMessage) {
        super("FILE_UPLOAD_ERROR", HttpStatus.BAD_REQUEST, logMessage);
    }
}
