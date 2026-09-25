package app.billetstudio.shared.exception;

import java.util.stream.Collectors;

import jakarta.persistence.OptimisticLockException;
import jakarta.servlet.http.HttpServletResponse;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.ConversionNotSupportedException;
import org.springframework.beans.TypeMismatchException;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingPathVariableException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import tools.jackson.core.exc.StreamConstraintsException;

/**
 * Turns every failure into an {@link ApiError}. Framework errors arrive through the base class and are
 * mapped in {@link #handleExceptionInternal}, so malformed JSON is a 400 and an unknown route a 404 instead
 * of the catch-all 500. Field names and Bean Validation messages are logged only: the contract is
 * code-only, i18n happens in the frontend.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final String VALIDATION_ERROR = "VALIDATION_ERROR";
    private static final String INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR";

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApiException(ApiException ex) {
        String detail = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        if (ex.getStatus().is5xxServerError()) {
            log.error("{} ({}): {}", ex.getErrorCode(), ex.getStatus().value(), detail, ex);
        } else {
            log.warn("{} ({}): {}", ex.getErrorCode(), ex.getStatus().value(), detail);
        }
        return error(ex.getStatus(), ex.getErrorCode());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex) {
        log.warn("Access denied: {}", ex.getMessage());
        return error(HttpStatus.FORBIDDEN, "ACCESS_DENIED");
    }

    /**
     * Both types are listed because Spring translates the JPA one on repository calls and at commit, so
     * the jakarta type alone never arrives here.
     */
    @ExceptionHandler({OptimisticLockException.class, ObjectOptimisticLockingFailureException.class})
    public ResponseEntity<ApiError> handleOptimisticLock(Exception ex) {
        log.warn("Optimistic lock conflict: {}", ex.getMessage());
        return error(HttpStatus.CONFLICT, "CONCURRENT_MODIFICATION");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return error(HttpStatus.CONFLICT, "DATA_INTEGRITY_ERROR");
    }

    /** Malformed multipart bodies; the size limit is the more specific MaxUploadSizeExceededException. */
    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ApiError> handleMultipart(MultipartException ex) {
        log.warn("Malformed multipart upload: {}", ex.getMessage());
        return error(HttpStatus.BAD_REQUEST, "FILE_UPLOAD_ERROR");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        log.error("Unhandled exception: {}", ex.getClass().getName(), ex);
        return error(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR);
    }

    /** The client is gone, so there is nobody to write a body to (writing one would throw again). */
    @Override
    protected ResponseEntity<Object> handleAsyncRequestNotUsableException(AsyncRequestNotUsableException ex,
        WebRequest request) {
        log.debug("Client disconnected: {}", ex.getMessage());
        return null;
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
        HttpStatusCode statusCode, WebRequest request) {
        if (request instanceof ServletWebRequest servletRequest) {
            HttpServletResponse response = servletRequest.getResponse();
            if (response != null && response.isCommitted()) {
                log.warn("Response already committed, cannot report {}", ex.getClass().getName());
                return null;
            }
        }
        // The client accepts nothing we can produce, an ApiError body included.
        if (statusCode.value() == HttpStatus.NOT_ACCEPTABLE.value()) {
            return ResponseEntity.status(statusCode).headers(headers).build();
        }

        Mapping mapping = map(ex, statusCode);
        logMapped(ex, mapping);
        return ResponseEntity.status(mapping.status())
            .headers(headers)
            .body(new ApiError(mapping.errorCode(), mapping.status().value()));
    }

    private record Mapping(HttpStatus status, String errorCode) {
    }

    private Mapping map(Exception ex, HttpStatusCode statusCode) {
        if (ex instanceof HttpMessageNotReadableException) {
            // A body cut off at its size cap, or past a parser limit (JacksonConfig), was not malformed, it was too
            // large - the code an oversized document gets.
            return causedBy(ex, RequestBodyTooLargeException.class) || causedBy(ex, StreamConstraintsException.class)
                ? new Mapping(HttpStatus.BAD_REQUEST, VALIDATION_ERROR)
                : new Mapping(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST");
        }
        if (ex instanceof MethodArgumentNotValidException || ex instanceof HandlerMethodValidationException) {
            return new Mapping(HttpStatus.BAD_REQUEST, VALIDATION_ERROR);
        }
        // Both extend a type mapped to 400 below but are server-side mistakes (a mapping without its
        // path variable, a parameter type without a converter), so they are checked first.
        if (ex instanceof MissingPathVariableException || ex instanceof ConversionNotSupportedException) {
            return new Mapping(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR);
        }
        if (ex instanceof ServletRequestBindingException || ex instanceof MissingServletRequestPartException
            || ex instanceof TypeMismatchException) {
            return new Mapping(HttpStatus.BAD_REQUEST, VALIDATION_ERROR);
        }
        if (ex instanceof NoResourceFoundException || ex instanceof NoHandlerFoundException) {
            return new Mapping(HttpStatus.NOT_FOUND, "NOT_FOUND");
        }
        if (ex instanceof HttpRequestMethodNotSupportedException) {
            return new Mapping(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED");
        }
        if (ex instanceof MaxUploadSizeExceededException) {
            return new Mapping(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE");
        }
        return byStatus(statusCode);
    }

    /** Everything else the base class knows (ErrorResponseException, media type, async timeout, ...). */
    private Mapping byStatus(HttpStatusCode statusCode) {
        HttpStatus status = HttpStatus.resolve(statusCode.value());
        if (status == null || status.is5xxServerError()) {
            return new Mapping(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_SERVER_ERROR);
        }
        return switch (status) {
        case UNAUTHORIZED -> new Mapping(status, "UNAUTHORIZED");
        case FORBIDDEN -> new Mapping(status, "ACCESS_DENIED");
        case NOT_FOUND -> new Mapping(status, "NOT_FOUND");
        case METHOD_NOT_ALLOWED -> new Mapping(status, "METHOD_NOT_ALLOWED");
        case CONTENT_TOO_LARGE -> new Mapping(status, "FILE_TOO_LARGE");
        case TOO_MANY_REQUESTS -> new Mapping(status, "RATE_LIMIT_EXCEEDED");
        default -> new Mapping(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST");
        };
    }

    private void logMapped(Exception ex, Mapping mapping) {
        if (mapping.status().is5xxServerError()) {
            log.error("Framework error {} -> {}", ex.getClass().getName(), mapping.errorCode(), ex);
        } else if (mapping.status() == HttpStatus.NOT_FOUND) {
            // Scanners probe unknown routes all day; that is not worth a warning each.
            log.debug("Unknown route: {}", ex.getMessage());
        } else if (ex instanceof MethodArgumentNotValidException invalid) {
            logFieldErrors(invalid);
        } else if (ex instanceof HandlerMethodValidationException invalid) {
            logParameterErrors(invalid);
        } else {
            log.warn("{} -> {}: {}", ex.getClass().getSimpleName(), mapping.errorCode(), ex.getMessage());
        }
    }

    private void logFieldErrors(MethodArgumentNotValidException ex) {
        log.warn("Validation failed: {}", ex.getBindingResult().getAllErrors().stream()
            .map(error -> (error instanceof FieldError field ? field.getField() : error.getObjectName()) + " "
                + error.getDefaultMessage())
            .collect(Collectors.joining("; ")));
    }

    private void logParameterErrors(HandlerMethodValidationException ex) {
        log.warn("Validation failed: {}", ex.getParameterValidationResults().stream()
            .map(result -> result.getMethodParameter().getParameterName() + " "
                + result.getResolvableErrors().stream()
                    .map(MessageSourceResolvable::getDefaultMessage)
                    .collect(Collectors.joining(", ")))
            .collect(Collectors.joining("; ")));
    }

    private static boolean causedBy(Throwable ex, Class<? extends Throwable> type) {
        for (Throwable cause = ex.getCause(); cause != null && cause != cause.getCause(); cause = cause.getCause()) {
            if (type.isInstance(cause)) {
                return true;
            }
        }
        return false;
    }

    private static ResponseEntity<ApiError> error(HttpStatus status, String errorCode) {
        return ResponseEntity.status(status).body(new ApiError(errorCode, status.value()));
    }
}
