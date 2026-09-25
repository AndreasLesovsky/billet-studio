package app.billetstudio.auth.util;

import org.jspecify.annotations.Nullable;

/**
 * Resolves a request's client IP under a single-trusted-proxy model.
 *
 * The reverse proxy in front of the app appends the real peer to X-Forwarded-For (nginx
 * $proxy_add_x_forwarded_for). The RIGHTMOST entry is the IP the proxy itself observed (the real client) and
 * the only one the client cannot forge; the LEFTMOST entry is fully client-controlled. Always take the
 * rightmost so a spoofed/rotated header cannot mint fresh rate-limit keys (defeating the /login and
 * /forgot-password brute-force limits) or poison the auth audit log. Assumes the app is reachable only THROUGH
 * the proxy; if the port is exposed directly, X-Forwarded-For is attacker-controlled regardless and the proxy
 * must strip/overwrite it.
 */
public final class ClientIp {

    private ClientIp() {
    }

    public static String resolve(@Nullable String xForwardedFor, String remoteAddr) {
        if (xForwardedFor != null && !xForwardedFor.isBlank()) {
            String[] hops = xForwardedFor.split(",");
            // Rightmost NON-BLANK hop, so a trailing comma ("1.2.3.4, ") cannot collapse the key to "".
            for (int i = hops.length - 1; i >= 0; i--) {
                String hop = hops[i].trim();
                if (!hop.isEmpty()) {
                    return hop;
                }
            }
        }
        return remoteAddr;
    }
}
