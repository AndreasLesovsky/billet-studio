package app.billetstudio.shared.web;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;

import app.billetstudio.billet.controller.BilletController;
import app.billetstudio.billet.dto.BilletImportRequest;
import app.billetstudio.shared.exception.RequestBodyTooLargeException;

import lombok.extern.slf4j.Slf4j;

import org.jspecify.annotations.NonNull;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

/**
 * Caps every request body before Jackson parses it, so an oversized body costs neither the memory nor the time of a
 * full parse - on the anonymous auth endpoints too. A declared Content-Length over the cap is refused unread; a body
 * without one (chunked) is cut off by the stream once it passes the cap. Both surface as RequestBodyTooLargeException,
 * which GlobalExceptionHandler answers with 400 VALIDATION_ERROR, like an oversized document.
 *
 * Bound to the handler, never to a URL pattern: the container decodes the path before Spring Security and Spring MVC
 * route it, so a match on the raw request URI is sidestepped by percent-encoding one letter (/v1/%62illets/5).
 *
 * {@link BilletController} carries documents and gets twice the document limit per document (whitespace, dropped
 * unknown fields); the exact limit, app.billet.max-document-bytes, is enforced on the normalized document by
 * BilletDocumentCodec. Every other body is a small form and gets {@link #DEFAULT_LIMIT}.
 */
@Slf4j
@ControllerAdvice
public class RequestBodyLimitAdvice extends RequestBodyAdviceAdapter {

    /** The largest form, an admin's UserRequestDto, stays under 1 KiB. */
    public static final long DEFAULT_LIMIT = 16 * 1024;

    private final long documentLimit;
    private final long importLimit;

    public RequestBodyLimitAdvice(@Value("${app.billet.max-document-bytes}") int maxDocumentBytes) {
        this.documentLimit = 2L * maxDocumentBytes;
        this.importLimit = importLimit(maxDocumentBytes);
    }

    /** The largest body any endpoint accepts. JacksonConfig caps the parser's document length at the same value. */
    public static long importLimit(int maxDocumentBytes) {
        return 2L * BilletImportRequest.MAX_DOCUMENTS * maxDocumentBytes;
    }

    @Override
    public boolean supports(@NonNull MethodParameter parameter, @NonNull Type targetType,
        @NonNull Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public @NonNull HttpInputMessage beforeBodyRead(@NonNull HttpInputMessage inputMessage,
        @NonNull MethodParameter parameter, @NonNull Type targetType,
        @NonNull Class<? extends HttpMessageConverter<?>> converterType) throws IOException {
        long limit = limitFor(parameter);
        HttpHeaders headers = inputMessage.getHeaders();
        long declared = headers.getContentLength();
        if (declared > limit) {
            log.warn("Request body refused: {} declares {} bytes, limit {}", parameter.getExecutable().getName(),
                declared, limit);
            throw new RequestBodyTooLargeException(limit);
        }
        InputStream body = new LimitedInputStream(inputMessage.getBody(), limit);
        return new HttpInputMessage() {
            @Override
            public @NonNull InputStream getBody() { return body; }

            @Override
            public @NonNull HttpHeaders getHeaders() { return headers; }
        };
    }

    private long limitFor(MethodParameter parameter) {
        if (!BilletController.class.isAssignableFrom(parameter.getContainingClass())) {
            return DEFAULT_LIMIT;
        }
        return parameter.getParameterType() == BilletImportRequest.class ? importLimit : documentLimit;
    }

    private static final class LimitedInputStream extends InputStream {

        private final InputStream delegate;
        private final long limit;
        private long count;

        LimitedInputStream(InputStream delegate, long limit) {
            this.delegate = delegate;
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int b = delegate.read();
            if (b != -1) {
                count(1);
            }
            return b;
        }

        @Override
        public int read(byte @NonNull [] buffer, int offset, int length) throws IOException {
            int read = delegate.read(buffer, offset, length);
            if (read > 0) {
                count(read);
            }
            return read;
        }

        private void count(int bytes) throws RequestBodyTooLargeException {
            count += bytes;
            if (count > limit) {
                throw new RequestBodyTooLargeException(limit);
            }
        }

        @Override
        public void close() throws IOException {
            delegate.close();
        }
    }
}
