package app.billetstudio.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;

import app.billetstudio.support.EnvExample;
import app.billetstudio.support.StandaloneMvc;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The boot guards on the signing key. What a signed token may reach - expired, foreign, malformed - is
 * JwtAuthenticationFilterTest.
 */
class JwtUtilTest {

    private static final long EXPIRATION_MS = 3_600_000L;

    /** A 40-byte key boots but throws WeakKeyException at the first HS512 sign: a 500 on every login. */
    @Test
    void constructor_throwsOnTooShortSecret() {
        String shortSecret = "0123456789012345678901234567890123456789"; // 40 bytes < 64
        assertThatThrownBy(() -> new JwtUtil(shortSecret, EXPIRATION_MS, false))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining(">=64 bytes");
    }

    /**
     * Both secrets that ship in the repository are public: a production copy of .env.example, or a forgotten
     * JWT_SECRET, would otherwise boot on a key anyone can sign admin tokens with. Read from the files themselves, so
     * a changed placeholder fails here until JwtUtil knows it.
     */
    @ParameterizedTest
    @MethodSource("inRepoSecrets")
    void constructor_refusesEverySecretThatShipsInTheRepositoryWhenEnforced(String secret) {
        assertThat(secret.getBytes(StandardCharsets.UTF_8).length).as("passes the length check").isGreaterThan(63);

        assertThatThrownBy(() -> new JwtUtil(secret, EXPIRATION_MS, true))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("ships in the repository");
    }

    static Stream<String> inRepoSecrets() {
        return Stream.of(StandaloneMvc.shippedConfiguration().getProperty("app.jwt.secret"),
            EnvExample.value("JWT_SECRET"));
    }
}
