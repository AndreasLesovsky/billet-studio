package app.billetstudio.auth.util;

import java.net.Inet4Address;
import java.net.InetAddress;

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

    /**
     * The rate-limit key of a resolved client IP. An IPv6 client counts by its /64, the smallest block a provider
     * hands one subscriber - by the full address, rotating through its own prefix would mint a fresh bucket per
     * request. IPv4, IPv4-mapped IPv6 included, stays the address. A value that is no IP literal is kept as it is; it
     * is never resolved through DNS.
     */
    public static String rateLimitKey(String clientIp) {
        InetAddress address;
        try {
            address = InetAddress.ofLiteral(clientIp);
        } catch (IllegalArgumentException e) {
            return clientIp;
        }
        if (address instanceof Inet4Address) {
            return address.getHostAddress();
        }
        byte[] bytes = address.getAddress();
        StringBuilder prefix = new StringBuilder();
        for (int i = 0; i < 8; i += 2) {
            prefix.append(Integer.toHexString((bytes[i] & 0xff) << 8 | bytes[i + 1] & 0xff)).append(':');
        }
        return prefix.append(":/64").toString();
    }
}
