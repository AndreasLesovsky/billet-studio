package app.billetstudio.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The repository's .env.example, read the way Spring imports a copy of it (a .properties file). Its values are
 * public, so a test can check that no boot guard accepts one of them as a production secret.
 */
public final class EnvExample {

    private static final Path FILE = Path.of("..", ".env.example");

    private EnvExample() {
    }

    /** The value of an active (not commented-out) line KEY=value; fails when the key is missing. */
    public static String value(String key) {
        try {
            return Files.readAllLines(FILE, StandardCharsets.UTF_8).stream()
                .filter(line -> line.startsWith(key + "="))
                .map(line -> line.substring(key.length() + 1).strip())
                .findFirst()
                .orElseThrow(() -> new AssertionError(key + " is not set in " + FILE.toAbsolutePath()));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
