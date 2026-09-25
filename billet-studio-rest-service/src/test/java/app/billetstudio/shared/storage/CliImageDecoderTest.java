package app.billetstudio.shared.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;

import app.billetstudio.shared.exception.FileTooLargeException;
import app.billetstudio.shared.exception.InvalidFileTypeException;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockMultipartFile;

/**
 * dwebp and avifdec allocate the whole canvas a file declares before Java sees a single pixel, so the canvas size is
 * read from the header and checked first. The configured tools exist nowhere: whether a test reached the tool shows
 * as the one-time "cannot be started" warning.
 */
class CliImageDecoderTest {

    private final CliImageDecoder decoder = new CliImageDecoder("billet-studio-missing-dwebp",
        "billet-studio-missing-avifdec");

    private final Logger logger = (Logger) LoggerFactory.getLogger(CliImageDecoder.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void captureLogs() {
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        logger.detachAppender(logs);
    }

    private boolean toolWasStarted() {
        return logs.list.stream().anyMatch(event -> event.getLevel() == Level.WARN
            && event.getFormattedMessage().contains("cannot be started"));
    }

    private static MockMultipartFile upload(String filename, byte[] bytes) {
        return new MockMultipartFile("image", filename, "application/octet-stream", bytes);
    }

    // ---------------------------------------------------------------- reading the header

    @Test
    void each_webp_bitstream_declares_its_canvas() {
        assertThat(ImageHeaders.webpPixels(ImageHeaderBytes.webpVp8x(16_383, 16_383))).isEqualTo(16_383L * 16_383);
        assertThat(ImageHeaders.webpPixels(ImageHeaderBytes.webpVp8x(1 << 24, 2))).isEqualTo(2L << 24);
        assertThat(ImageHeaders.webpPixels(ImageHeaderBytes.webpVp8l(300, 200))).isEqualTo(60_000);
        assertThat(ImageHeaders.webpPixels(ImageHeaderBytes.webpVp8l(16_384, 16_384))).isEqualTo(16_384L * 16_384);
        assertThat(ImageHeaders.webpPixels(ImageHeaderBytes.webpVp8(640, 480))).isEqualTo(307_200);
    }

    @Test
    void a_webp_written_by_a_real_encoder_is_read_right() throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByMIMEType("image/webp");
        assumeTrue(writers.hasNext(), "no WebP writer on this platform");
        ImageWriter writer = writers.next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(ios);
            writer.write(null, new IIOImage(filled(500, 300), null, null), writer.getDefaultWriteParam());
        } catch (LinkageError e) {
            assumeTrue(false, "WebP writer unusable on this platform: " + e);
        } finally {
            writer.dispose();
        }

        assertThat(ImageHeaders.webpPixels(out.toByteArray())).isEqualTo(150_000);
    }

    /** A grid image lists its tiles and the whole canvas; the largest one is what gets allocated. */
    @Test
    void avif_declares_its_largest_image_extent() {
        assertThat(ImageHeaders.avifPixels(ImageHeaderBytes.avif(512, 512, 20_000, 10_000)))
            .isEqualTo(200_000_000L);
        assertThat(ImageHeaders.avifPixels(ImageHeaderBytes.avif(0xFFFF_FFFFL, 0xFFFF_FFFFL)))
            .as("32-bit extents do not overflow into a small number")
            .isGreaterThan(ImageProcessor.MAX_PIXELS);
    }

    // ---------------------------------------------------------------- before the tool starts

    @Test
    void an_oversized_webp_canvas_is_too_large_before_dwebp_starts() {
        // A few bytes on the wire, about 1 GB of RGBA in dwebp.
        byte[] webp = ImageHeaderBytes.webpVp8x(16_383, 16_383);

        assertThatThrownBy(() -> decoder.toPng(upload("huge.webp", webp), "webp", ImageProcessor.MAX_PIXELS))
            .isInstanceOf(FileTooLargeException.class);
        assertThat(toolWasStarted()).isFalse();
    }

    @Test
    void an_oversized_avif_canvas_is_too_large_before_avifdec_starts() {
        byte[] avif = ImageHeaderBytes.avif(20_000, 20_000);

        assertThatThrownBy(() -> decoder.toPng(upload("huge.avif", avif), "avif", ImageProcessor.MAX_PIXELS))
            .isInstanceOf(FileTooLargeException.class);
        assertThat(toolWasStarted()).isFalse();
    }

    @Test
    void a_header_without_a_canvas_size_is_refused_without_starting_the_tool() {
        assertThatThrownBy(() -> decoder.toPng(upload("photo.webp", new byte[]{1, 2, 3}), "webp",
            ImageProcessor.MAX_PIXELS))
            .isInstanceOf(InvalidFileTypeException.class);
        assertThatThrownBy(() -> decoder.toPng(upload("photo.avif", ImageHeaderBytes.avif()), "avif",
            ImageProcessor.MAX_PIXELS))
            .isInstanceOf(InvalidFileTypeException.class);
        assertThatThrownBy(() -> decoder.toPng(upload("late-meta.avif",
            ImageHeaderBytes.avifWithMetaAfter(ImageHeaders.WINDOW_BYTES)), "avif", ImageProcessor.MAX_PIXELS))
            .isInstanceOf(InvalidFileTypeException.class);
        assertThat(toolWasStarted()).isFalse();
    }

    /** Also what makes the "never started" assertions above mean anything: the detection does see a start. */
    @Test
    void a_canvas_within_the_limit_goes_on_to_the_tool() {
        assertThatThrownBy(() -> decoder.toPng(upload("photo.webp", ImageHeaderBytes.webpVp8(640, 480)), "webp",
            ImageProcessor.MAX_PIXELS))
            .isInstanceOf(InvalidFileTypeException.class);

        assertThat(toolWasStarted()).isTrue();
    }

    private static BufferedImage filled(int width, int height) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.ORANGE);
        g.fillRect(0, 0, width, height);
        g.dispose();
        return image;
    }
}
