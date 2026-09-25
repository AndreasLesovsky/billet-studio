package app.billetstudio.shared.storage;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import app.billetstudio.shared.exception.FileTooLargeException;
import app.billetstudio.shared.exception.InvalidFileTypeException;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/**
 * Decodes the formats the JVM does not read reliably - WebP (the webp-imageio native reader is unstable) and
 * AVIF (no reader at all) - with a CLI tool into a temporary PNG. The backend image ships dwebp (libwebp-tools)
 * and avifdec (libavif-apps). Without a tool (a Windows dev machine) such uploads are refused as
 * INVALID_FILE_TYPE, never a 500.
 */
@Slf4j
@Component
public class CliImageDecoder {

    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final int MAX_LOGGED_OUTPUT = 500;

    private final String dwebp;
    private final String avifdec;

    /** Tools already reported as missing: one warning per tool, not one per upload. */
    private final Set<String> reportedMissing = ConcurrentHashMap.newKeySet();

    public CliImageDecoder(@Value("${app.upload.dwebp:dwebp}") String dwebp,
        @Value("${app.upload.avifdec:avifdec}") String avifdec) {
        this.dwebp = dwebp;
        this.avifdec = avifdec;
    }

    public boolean handles(String extension) {
        return "webp".equals(extension) || "avif".equals(extension);
    }

    /**
     * Decodes the upload into a temporary PNG; the caller deletes it.
     *
     * @throws FileTooLargeException
     *         when the header declares more than maxPixels - checked before the tool starts, since the tool
     *         allocates the whole canvas before anyone could look at the PNG it writes
     * @throws InvalidFileTypeException
     *         when the header declares no canvas size, or the tool fails
     */
    public Path toPng(MultipartFile file, String extension, long maxPixels) throws IOException {
        long pixels = declaredPixels(file, extension);
        if (pixels < 0) {
            throw new InvalidFileTypeException("No canvas size in the " + extension + " header");
        }
        if (pixels > maxPixels) {
            throw new FileTooLargeException(extension + " canvas of " + pixels + " pixels");
        }

        Path input = Files.createTempFile("upload_", "." + extension);
        Path output = Files.createTempFile("decoded_", ".png");
        Path toolOutput = Files.createTempFile("decoder_", ".log");
        boolean decoded = false;
        try {
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, input, StandardCopyOption.REPLACE_EXISTING);
            }
            // dwebp: <in> -o <out.png>; avifdec: <in> <out.png>
            List<String> command = "avif".equals(extension)
                ? List.of(avifdec, input.toString(), output.toString())
                : List.of(dwebp, input.toString(), "-o", output.toString());
            run(command, toolOutput);
            decoded = true;
            return output;
        } finally {
            Files.deleteIfExists(input);
            Files.deleteIfExists(toolOutput);
            if (!decoded) {
                Files.deleteIfExists(output);
            }
        }
    }

    private static long declaredPixels(MultipartFile file, String extension) throws IOException {
        byte[] head;
        try (InputStream in = file.getInputStream()) {
            head = in.readNBytes(ImageHeaders.WINDOW_BYTES);
        }
        return "avif".equals(extension) ? ImageHeaders.avifPixels(head) : ImageHeaders.webpPixels(head);
    }

    private void run(List<String> command, Path toolOutput) throws IOException {
        String tool = command.getFirst();
        Process process;
        try {
            process = new ProcessBuilder(command)
                .redirectErrorStream(true)
                .redirectOutput(toolOutput.toFile())
                .start();
        } catch (IOException e) {
            if (reportedMissing.add(tool)) {
                log.warn("Image decoder '{}' cannot be started, so these uploads are refused as INVALID_FILE_TYPE "
                    + "until it is installed or app.upload.dwebp / app.upload.avifdec points to it: {}", tool,
                    e.getMessage());
            }
            throw new InvalidFileTypeException("Decoder not available: " + tool);
        }

        try {
            if (!process.waitFor(TIMEOUT)) {
                process.destroyForcibly();
                throw new InvalidFileTypeException("Decoder timed out after " + TIMEOUT + ": " + tool);
            }
        } catch (InterruptedException e) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("Image decoding was interrupted", e);
        }

        if (process.exitValue() != 0) {
            throw new InvalidFileTypeException(
                "Decoder " + tool + " failed (exit " + process.exitValue() + "): " + readOutput(toolOutput));
        }
    }

    private static String readOutput(Path toolOutput) {
        try {
            String output = Files.readString(toolOutput, StandardCharsets.UTF_8).strip();
            return output.length() > MAX_LOGGED_OUTPUT ? output.substring(0, MAX_LOGGED_OUTPUT) + "..." : output;
        } catch (IOException e) {
            return "(output unreadable)";
        }
    }
}
