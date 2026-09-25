package app.billetstudio.shared.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicLong;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Filesystem storage for processed images under app.upload.directory. Single responsibility: write and
 * delete files and build their relative URLs; image processing happens before the bytes arrive here.
 *
 * URL shape: /uploads/{subdir}/{filename}.webp - served by the /uploads/** handler in WebConfig.
 */
@Slf4j
@Service
public class FileStorageService {

    public static final String AVATARS_SUBDIR = "avatars";
    private static final String URL_PREFIX = "/uploads/";

    @Value("${app.upload.directory}")
    private String uploadBaseDir;

    /** Monotonic suffix so several files written in the same millisecond never collide. */
    private final AtomicLong sequence = new AtomicLong();

    public String storeAvatar(byte[] webpBytes, Long userId) throws IOException {
        return store(webpBytes, AVATARS_SUBDIR, "user_" + userId);
    }

    private String store(byte[] bytes, String subdir, String baseName) throws IOException {
        Path uploadPath = Path.of(uploadBaseDir, subdir);
        if (!Files.exists(uploadPath)) {
            Files.createDirectories(uploadPath);
            log.info("Created upload directory: {}", uploadPath.toAbsolutePath());
        }
        String filename = baseName + "_" + System.currentTimeMillis() + "_" + sequence.incrementAndGet() + ".webp";
        Files.write(uploadPath.resolve(filename), bytes);
        String url = URL_PREFIX + subdir + "/" + filename;
        log.info("Image stored: {}", url);
        return url;
    }

    /** Delete a stored file. No-op for blank, external or foreign URLs; failures are logged, never thrown. */
    public void delete(String imageUrl) {
        if (imageUrl == null || imageUrl.isEmpty()) {
            return;
        }
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
            log.info("Skipping deletion of external image URL: {}", imageUrl);
            return;
        }
        Path location = resolveLocal(imageUrl);
        if (location == null) {
            return;
        }
        try {
            if (Files.deleteIfExists(location)) {
                log.info("Image deleted: {}", imageUrl);
            }
        } catch (IOException e) {
            log.error("Failed to delete image: {}", imageUrl, e);
        }
    }

    /** Resolve a /uploads/{subdir}/{file} URL to an on-disk path, or null if it is not one of ours. */
    private Path resolveLocal(String url) {
        int prefixAt = url.indexOf(URL_PREFIX);
        if (prefixAt < 0) {
            log.warn("Unrecognized image URL, not deleting: {}", url);
            return null;
        }
        String rest = url.substring(prefixAt + URL_PREFIX.length());
        int slash = rest.indexOf('/');
        if (slash <= 0 || slash == rest.length() - 1) {
            log.warn("Malformed image URL, not deleting: {}", url);
            return null;
        }
        String subdir = rest.substring(0, slash);
        String filename = rest.substring(slash + 1);

        // Containment check: a crafted URL (".../avatars/../../etc/x") must never resolve outside the
        // upload directory.
        Path base = Path.of(uploadBaseDir).toAbsolutePath().normalize();
        Path resolved = base.resolve(subdir).resolve(filename).normalize();
        if (!resolved.startsWith(base)) {
            log.warn("Image URL escapes the upload directory, refusing: {}", url);
            return null;
        }
        return resolved;
    }
}
