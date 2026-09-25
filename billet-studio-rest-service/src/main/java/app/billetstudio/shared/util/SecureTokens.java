package app.billetstudio.shared.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Minting a capability token and hashing it for storage. URL-safe Base64, no padding; 32 bytes = 256 bits,
 * 16 bytes = 128 bits (22 chars, the share-token width), so no uniqueness retry is needed.
 *
 * A token that merely NAMES something (share link) is stored raw. A token that IS a credential (password
 * reset, auth session) is stored only as {@link #sha256Hex(String)}.
 */
public final class SecureTokens {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private SecureTokens() {
    }

    public static String urlSafeToken(int byteLength) {
        byte[] bytes = new byte[byteLength];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * Lowercase hex SHA-256, 64 chars - hence the CHAR(64) columns. No salt and no work factor: the input
     * already carries 256 bits of entropy, so there is nothing to brute-force.
     */
    public static String sha256Hex(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
