package app.billetstudio.auth.security;

import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Carries the refresh token, HttpOnly so no script can read it.
 *
 * Path is /v1/auth, not /v1/auth/refresh: scoped to the refresh endpoint alone it would never reach logout,
 * whose job is to delete it. SameSite=Strict works because frontend and API are the same site.
 */
@Component
public class RefreshCookie {

    public static final String NAME = "refresh_token";
    private static final String PATH = "/v1/auth";

    private final boolean secure;
    private final String sameSite;

    public RefreshCookie(@Value("${app.auth.cookie.secure:true}") boolean secure,
        @Value("${app.auth.cookie.same-site:Strict}") String sameSite) {
        this.secure = secure;
        this.sameSite = sameSite;
    }

    public ResponseCookie issue(String rawToken, Duration maxAge) {
        return base(rawToken).maxAge(maxAge).build();
    }

    /** Same name, path and attributes with an empty value and zero age - anything else leaves it. */
    public ResponseCookie clear() {
        return base("").maxAge(0).build();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value)
            .httpOnly(true)
            .secure(secure)
            .sameSite(sameSite)
            .path(PATH);
    }
}
