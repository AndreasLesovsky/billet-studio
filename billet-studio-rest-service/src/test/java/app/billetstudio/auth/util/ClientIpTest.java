package app.billetstudio.auth.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * The rate-limit / audit-log client IP must be derived from the RIGHTMOST X-Forwarded-For hop (the IP the trusted
 * nginx observed), never the leftmost (client-controlled). Otherwise an attacker rotates X-Forwarded-For[0] per
 * request to mint fresh rate-limit keys and bypass the brute-force limits on /login and /forgot-password. No header
 * at all (the remote address) is RegisterRateLimitIT.
 */
class ClientIpTest {

    @ParameterizedTest(name = "\"{0}\" -> {1}")
    @CsvSource(delimiter = '|', value = {
        // The client forges the left; nginx appends the real peer on the right.
        "evil, 198.51.100.4, 203.0.113.9 | 203.0.113.9",
        // Degenerate, never emitted by nginx - but it must not collapse every such request onto one empty key.
        "'203.0.113.9, '                 | 203.0.113.9",
        "'   '                           | 10.0.0.1"
    })
    void theRightmostNonBlankHopIsTheClient(String xForwardedFor, String expected) {
        assertThat(ClientIp.resolve(xForwardedFor, "10.0.0.1")).isEqualTo(expected);
    }

    /** One IPv6 subscriber holds a whole /64; keyed by the full address, each address would be a fresh bucket. */
    @ParameterizedTest(name = "{0} -> {1}")
    @CsvSource(delimiter = '|', value = {
        "203.0.113.9                      | 203.0.113.9",
        "2001:db8:1:2:aaaa:bbbb:cccc:dddd | 2001:db8:1:2::/64",
        "2001:db8:1:2::1                  | 2001:db8:1:2::/64",
        // Tomcat's spelling of ::1.
        "0:0:0:0:0:0:0:1                  | 0:0:0:0::/64",
        "::ffff:203.0.113.9               | 203.0.113.9",
        // No IP literal (the proxy is missing): kept as it is, never looked up in DNS.
        "localhost                        | localhost"
    })
    void anIpv6ClientIsKeyedByItsSlash64_anIpv4ClientByItsAddress(String clientIp, String expectedKey) {
        assertThat(ClientIp.rateLimitKey(clientIp)).isEqualTo(expectedKey);
    }
}
