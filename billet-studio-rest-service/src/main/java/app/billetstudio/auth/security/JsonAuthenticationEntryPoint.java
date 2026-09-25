package app.billetstudio.auth.security;

import java.io.IOException;

import app.billetstudio.shared.exception.ApiError;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/**
 * The one place that answers "you are not authenticated" (401) and, for the URL rules in SecurityConfig, "you may
 * not do this" (403), with the same ApiError GlobalExceptionHandler returns.
 *
 * Without it Spring Security falls back to Http403ForbiddenEntryPoint, so a request carrying NO credentials
 * would be answered 403 - the code that means "your credentials are fine, you may not do this". The
 * distinction is load-bearing for the client: 401 means "get a new token and retry", 403 means "retrying will
 * never help".
 *
 * The default access-denied handler is no better: it calls sendError(403), and the container's forward to /error
 * runs without the JWT authentication, so the client would see a 401 and log the user out. Writing the body here
 * never leaves the request.
 *
 * JwtAuthenticationFilter runs before the exception translation filter and calls in here rather than
 * hand-rolling a second JSON body - one 401 shape for the whole application.
 */
@Component
public class JsonAuthenticationEntryPoint implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final JsonMapper jsonMapper;

    public JsonAuthenticationEntryPoint(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
        AuthenticationException authException) throws IOException {
        writeUnauthorized(response);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
        AccessDeniedException accessDeniedException) throws IOException {
        write(response, HttpStatus.FORBIDDEN, "ACCESS_DENIED");
    }

    /** Deliberately says nothing about WHY - no account state leaks through an auth failure. */
    public void writeUnauthorized(HttpServletResponse response) throws IOException {
        write(response, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }

    private void write(HttpServletResponse response, HttpStatus status, String errorCode) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        jsonMapper.writeValue(response.getWriter(), new ApiError(errorCode, status.value()));
    }
}
