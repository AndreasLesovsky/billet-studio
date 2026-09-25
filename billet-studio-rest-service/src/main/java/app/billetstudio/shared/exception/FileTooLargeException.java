package app.billetstudio.shared.exception;

import org.springframework.http.HttpStatus;

/**
 * An upload over the byte or pixel limit. Same code as the multipart size limit, which GlobalExceptionHandler
 * maps from MaxUploadSizeExceededException.
 */
public class FileTooLargeException extends ApiException {

    /**
     * @param logMessage
     *        which limit was exceeded - server log only
     */
    public FileTooLargeException(String logMessage) {
        super("FILE_TOO_LARGE", HttpStatus.CONTENT_TOO_LARGE, logMessage);
    }
}
