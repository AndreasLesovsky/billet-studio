package app.billetstudio.auth.controller;

import java.time.Duration;
import java.time.temporal.ChronoUnit;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.dto.ForgotPasswordRequestDto;
import app.billetstudio.auth.dto.LoginRequestDto;
import app.billetstudio.auth.dto.RegisterRequestDto;
import app.billetstudio.auth.dto.ResetPasswordRequestDto;
import app.billetstudio.auth.dto.UserResponseDto;
import app.billetstudio.auth.dto.UserWithTokenDto;
import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.event.UserRegisteredEvent;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.security.JwtUtil;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AuthResult;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.UserService;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequestMapping("/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final UserService userService;
    private final AuthSessionService authSessionService;
    private final RefreshCookie refreshCookie;
    private final JwtUtil jwtUtil;
    private final ApplicationEventPublisher eventPublisher;

    @PostMapping("/login")
    @RateLimited(limit = 10, duration = 15, unit = ChronoUnit.MINUTES)
    public ResponseEntity<UserWithTokenDto> login(@Valid @RequestBody LoginRequestDto request) {
        AuthResult result = userService.authenticate(request.email(), request.password());
        User user = result.user();

        AuthSessionService.IssuedSession issued = authSessionService.startSession(user);
        Duration remaining = authSessionService.remainingFor(issued.session());

        log.info("User logged in: id={}", user.getId());
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, refreshCookie.issue(issued.rawToken(), remaining).toString())
            .body(respond(user, result.reactivated(), remaining));
    }

    /**
     * The only way to get a new access token. Authorised by the refresh cookie, not by the Authorization header,
     * so it works precisely when the access token does not. It answers with the user as well: the JWT carries
     * only the subject, so after a reload this is where the frontend learns its own name and role.
     */
    @PostMapping("/refresh")
    public ResponseEntity<UserWithTokenDto> refresh(
        @CookieValue(name = RefreshCookie.NAME, required = false) String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new JwtAuthException();
        }

        AuthSession session = authSessionService.refresh(refreshToken);
        Duration remaining = authSessionService.remainingFor(session);

        // Same token, renewed Max-Age: the browser copy must not expire before the row does.
        return ResponseEntity.ok()
            .header(HttpHeaders.SET_COOKIE, refreshCookie.issue(refreshToken, remaining).toString())
            .body(respond(session.getUser(), false, remaining));
    }

    /** Ends the session for real by deleting its row; clearing only the SecurityContext would mean nothing. */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
        @CookieValue(name = RefreshCookie.NAME, required = false) String refreshToken) {
        if (refreshToken != null && !refreshToken.isBlank()) {
            authSessionService.endSession(refreshToken);
        }
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent()
            .header(HttpHeaders.SET_COOKIE, refreshCookie.clear().toString())
            .build();
    }

    /** Public sign-up as ROLE_USER. No auto-login: the client logs in afterwards. */
    @PostMapping("/register")
    @RateLimited(config = "app.auth.register-rate-limit")
    public ResponseEntity<UserResponseDto> register(@Valid @RequestBody RegisterRequestDto request) {
        UserResponseDto user = userService.register(request);
        eventPublisher.publishEvent(new UserRegisteredEvent(user.id(), user.name(), user.email()));
        log.info("New user registered: id={}", user.id());
        return ResponseEntity.status(HttpStatus.CREATED).body(user);
    }

    /** Always 200, whether or not the email has an account (no enumeration). */
    @PostMapping("/forgot-password")
    @RateLimited(limit = 5, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<Void> forgotPassword(@Valid @RequestBody ForgotPasswordRequestDto request) {
        userService.requestPasswordReset(request.email());
        return ResponseEntity.ok().build();
    }

    @PostMapping("/reset-password")
    @RateLimited(limit = 10, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<Void> resetPassword(@Valid @RequestBody ResetPasswordRequestDto request) {
        userService.resetPassword(request.token(), request.newPassword(), request.confirmPassword());
        return ResponseEntity.noContent().build();
    }

    private UserWithTokenDto respond(User user, boolean reactivated, Duration remaining) {
        return new UserWithTokenDto(
            user.getId(),
            user.getName(),
            user.getEmail(),
            jwtUtil.generateToken(user.getId()),
            user.getRole().getName(),
            reactivated,
            user.getAvatarUrl(),
            // Rounded, not truncated: a window a few millis short of three minutes would report 179.
            Math.round(remaining.toMillis() / 1000.0));
    }
}
