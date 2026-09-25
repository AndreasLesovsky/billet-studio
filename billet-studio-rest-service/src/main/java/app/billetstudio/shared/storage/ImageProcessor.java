package app.billetstudio.shared.storage;

import java.awt.Rectangle;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import javax.imageio.IIOException;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;

import app.billetstudio.auth.exception.RateLimitExceededException;
import app.billetstudio.shared.exception.ApiException;
import app.billetstudio.shared.exception.FileTooLargeException;
import app.billetstudio.shared.exception.FileUploadException;
import app.billetstudio.shared.exception.InvalidFileTypeException;

import lombok.extern.slf4j.Slf4j;

import org.springframework.web.multipart.MultipartFile;

/**
 * Upload pipeline for one kind of image: validate, decode, transform, encode to WebP. Subclasses implement the
 * transform; storing the bytes is FileStorageService's job.
 */
@Slf4j
public abstract class ImageProcessor {

    /** The multipart limit (spring.servlet.multipart.max-file-size) normally refuses a larger upload first. */
    static final long MAX_FILE_BYTES = 20L * 1024 * 1024;

    /** Decoding cost follows the pixel count, not the byte count: a small PNG can declare a gigapixel canvas. */
    static final long MAX_PIXELS = 100_000_000L;

    /** The raster actually allocated (source region after subsampling), whatever a subclass asks for. */
    static final long MAX_DECODED_PIXELS = 16_000_000L;

    /**
     * Decodes running at once, across all processors. Below MAX_PIXELS one decode can still hold hundreds of MB
     * outside the Java raster (a CLI decoder's full-size bitmap, a progressive JPEG's coefficient buffers), so a
     * burst of uploads queues here instead of adding up.
     */
    static final int CONCURRENT_DECODES = 2;
    static final Semaphore DECODE_PERMITS = new Semaphore(CONCURRENT_DECODES, true);
    private static final Duration DECODE_WAIT = Duration.ofSeconds(30);

    /** MIRRORS the frontend's accepted image list and the contract's /v1/account/avatar row. */
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "bmp", "webp", "avif");

    private final CliImageDecoder cliDecoder;

    protected ImageProcessor(CliImageDecoder cliDecoder) {
        this.cliDecoder = cliDecoder;
    }

    /**
     * Returns the encoded bytes (PNG bytes as a fallback when no WebP writer works).
     *
     * @throws FileUploadException
     *         for an empty upload
     * @throws FileTooLargeException
     *         over {@link #MAX_FILE_BYTES}, {@link #MAX_PIXELS} or {@link #MAX_DECODED_PIXELS}
     * @throws InvalidFileTypeException
     *         for an extension outside the list, bytes that do not decode, or a missing CLI decoder
     * @throws RateLimitExceededException
     *         when no decode slot frees up within {@link #DECODE_WAIT}
     */
    public byte[] processToWebp(MultipartFile file) throws IOException {
        String extension = validate(file);
        BufferedImage image;
        acquireDecodePermit();
        try {
            image = process(read(file, extension));
        } finally {
            DECODE_PERMITS.release();
        }
        return encodeWebp(image);
    }

    /** Transforms the decoded image (crop, resize). */
    protected abstract BufferedImage process(BufferedImage original);

    /** The part of the source the transform keeps; nothing outside it is decoded. Defaults to the whole image. */
    protected Rectangle sourceRegion(int width, int height) {
        return new Rectangle(0, 0, width, height);
    }

    /**
     * Source pixels skipped per decoded pixel in each direction (1 = full resolution), for a source region of the
     * given size. Lets a large photo decode straight to the size the transform needs.
     */
    protected abstract int subsampling(int width, int height);

    private static void acquireDecodePermit() throws IOException {
        try {
            if (!DECODE_PERMITS.tryAcquire(DECODE_WAIT.toMillis(), TimeUnit.MILLISECONDS)) {
                log.warn("No image decode slot free within {}, upload refused", DECODE_WAIT);
                throw new RateLimitExceededException();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while waiting for an image decode slot", e);
        }
    }

    private static String validate(MultipartFile file) {
        if (file.isEmpty()) {
            throw new FileUploadException("Empty upload");
        }
        if (file.getSize() > MAX_FILE_BYTES) {
            throw new FileTooLargeException("Upload of " + file.getSize() + " bytes");
        }
        String extension = extensionOf(file.getOriginalFilename());
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new InvalidFileTypeException("Extension not allowed: '" + extension + "'");
        }
        return extension;
    }

    private BufferedImage read(MultipartFile file, String extension) throws IOException {
        if (!cliDecoder.handles(extension)) {
            try (InputStream in = file.getInputStream()) {
                return decode(in);
            }
        }
        Path png = cliDecoder.toPng(file, extension, MAX_PIXELS);
        try (InputStream in = Files.newInputStream(png)) {
            return decode(in);
        } finally {
            Files.deleteIfExists(png);
        }
    }

    /** The format is detected from the bytes; the extension only decided whether a CLI decoder runs first. */
    private BufferedImage decode(InputStream source) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(source)) {
            if (input == null) {
                throw new IOException("No ImageInputStream for the upload");
            }
            ImageReader reader = readerFor(input);
            try {
                reader.setInput(input, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if ((long) width * height > MAX_PIXELS) {
                    throw new FileTooLargeException("Image of " + width + "x" + height + " pixels");
                }
                Rectangle region = sourceRegion(width, height);
                int step = Math.max(1, subsampling(region.width, region.height));
                long decodedPixels = (long) Math.ceilDiv(region.width, step) * Math.ceilDiv(region.height, step);
                if (decodedPixels > MAX_DECODED_PIXELS) {
                    throw new FileTooLargeException("Decoding " + region.width + "x" + region.height + " of "
                        + width + "x" + height + " at 1/" + step + " would allocate " + decodedPixels + " pixels");
                }
                ImageReadParam param = reader.getDefaultReadParam();
                param.setSourceRegion(region);
                if (step > 1) {
                    param.setSourceSubsampling(step, step, 0, 0);
                }
                return reader.read(0, param);
            } catch (ApiException e) {
                throw e;
            } catch (IIOException | RuntimeException e) {
                // Corrupt or crafted bytes; decoders also signal those with runtime exceptions.
                throw new InvalidFileTypeException("Image does not decode: " + e);
            } finally {
                reader.dispose();
            }
        }
    }

    /**
     * WebP bytes always go through dwebp, including a WebP renamed to .png: the webp-imageio reader is the
     * native decoder CommerceX moved away from, so it is never picked here.
     */
    private static ImageReader readerFor(ImageInputStream input) {
        Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
        while (readers.hasNext()) {
            ImageReader reader = readers.next();
            boolean webp = reader.getOriginatingProvider() != null && Arrays.stream(reader.getOriginatingProvider()
                .getFormatNames()).anyMatch("webp"::equalsIgnoreCase);
            if (!webp) {
                return reader;
            }
            reader.dispose();
        }
        throw new InvalidFileTypeException("No decoder for the uploaded bytes");
    }

    private static byte[] encodeWebp(BufferedImage image) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByMIMEType("image/webp");
        if (writers.hasNext()) {
            ImageWriter writer = writers.next();
            try {
                // Closing the stream is what moves its cache into `out`.
                try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
                    writer.setOutput(ios);
                    writer.write(null, new IIOImage(image, null, null), writer.getDefaultWriteParam());
                }
                return out.toByteArray();
            } catch (LinkageError e) {
                // The writer is a JNI binding; a platform without its native library must not fail the upload.
                log.error("WebP writer unusable on this platform, falling back to PNG", e);
                out.reset();
            } finally {
                writer.dispose();
            }
        } else {
            log.warn("WebP writer not available, falling back to PNG");
        }
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private static String extensionOf(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        return dot == -1 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
    }
}
