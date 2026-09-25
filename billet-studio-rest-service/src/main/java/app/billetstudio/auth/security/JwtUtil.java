package app.billetstudio.auth.security;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Set;

import javax.crypto.SecretKey;

import app.billetstudio.auth.exception.JwtAuthException;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Slf4j
@Component
public class JwtUtil {

    // HS512 needs a >=64-byte key. A shorter key boots but throws WeakKeyException at the first sign (runtime
    // 500), so it is rejected at startup with an actionable message instead.
    private static final int MIN_SECRET_BYTES = 64;

    // Every JWT secret that ships in the repository, and is therefore public: the application.yml fallback and the
    // .env.example value (a production file copied from it). Keep in sync with both; JwtUtilTest reads them.
    private static final Set<String> IN_REPO_SECRETS = Set.of(
        "dev-only-secret-change-in-production-hs512-needs-64-bytes-minimum",
        "local-dev-only-jwt-secret-replace-with-output-of-openssl-rand-hex-32");

    private final SecretKey key;
    private final long expirationMs;

    public JwtUtil(@Value("${app.jwt.secret}") String secret,
        @Value("${app.jwt.expiration-ms}") long expirationMs,
        @Value("${app.security.enforce-strong-secrets:true}") boolean enforceStrongSecrets) {
        validateSecret(secret, enforceStrongSecrets);
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationMs = expirationMs;
    }

    /**
     * Fail-closed boot guard. Throwing aborts the Spring context so a misconfigured secret can never reach
     * production silently. Blank or sub-64-byte secrets are rejected unconditionally; the in-repo secrets are
     * rejected only when strong-secret enforcement is enabled (production sets it true).
     */
    private static void validateSecret(String secret, boolean enforceStrongSecrets) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                "JWT_SECRET is blank. Set a >=64-byte high-entropy secret (e.g. openssl rand -hex 32).");
        }
        if (secret.getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                "JWT_SECRET must be >=64 bytes for HS512. Generate one with: openssl rand -hex 32");
        }
        if (enforceStrongSecrets && IN_REPO_SECRETS.contains(secret)) {
            throw new IllegalStateException(
                "Refusing to boot on a JWT secret that ships in the repository (dev-default or .env.example). "
                    + "Set a real JWT_SECRET, or ENFORCE_STRONG_SECRETS=false for local development.");
        }
    }

    public String generateToken(Long userId) {
        Date now = new Date();
        Date exp = new Date(now.getTime() + expirationMs);
        return Jwts.builder()
            .subject(String.valueOf(userId))
            .issuedAt(now)
            .expiration(exp)
            .signWith(key, Jwts.SIG.HS512)
            .compact();
    }

    public Long validateTokenAndGetUserId(String token) {
        if (token == null || token.isBlank()) {
            log.warn("JWT validation failed: token is null or blank");
            throw new JwtAuthException();
        }
        try {
            Jws<Claims> claimsJws = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token);
            return Long.parseLong(claimsJws.getPayload().getSubject());
        } catch (ExpiredJwtException e) {
            log.warn("JWT expired for userId={}", e.getClaims().getSubject());
            throw new JwtAuthException();
        } catch (JwtException | IllegalArgumentException e) {
            log.warn("JWT validation failed: {}", e.getMessage());
            throw new JwtAuthException();
        }
    }
}
