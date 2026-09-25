package app.billetstudio.shared.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.imageio.ImageIO;

import app.billetstudio.shared.exception.FileTooLargeException;
import app.billetstudio.shared.exception.InvalidFileTypeException;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockMultipartFile;

class AvatarImageProcessorTest {

    /** A command that exists nowhere, so the WebP/AVIF path behaves like a dev machine without the tools. */
    private final AvatarImageProcessor processor = new AvatarImageProcessor(
        new CliImageDecoder("billet-studio-missing-dwebp", "billet-studio-missing-avifdec"));

    /** PNG is AccountControllerIT. The photo format, under both its extensions and in capitals. */
    @ParameterizedTest
    @ValueSource(strings = {"jpg", "jpeg"})
    void a_jpeg_comes_out_as_webp(String extension) throws IOException {
        String format = extension.equals("jpg") ? "jpeg" : extension;
        MockMultipartFile upload = upload("photo." + extension.toUpperCase(),
            encode(filled(1200, 900, BufferedImage.TYPE_INT_RGB, Color.RED), format));

        assertThat(isWebp(processor.processToWebp(upload))).isTrue();
    }

    @Test
    void an_extension_outside_the_list_is_refused() {
        assertThatThrownBy(() -> processor.processToWebp(upload("notes.txt", "hello".getBytes())))
            .isInstanceOf(InvalidFileTypeException.class);
        assertThatThrownBy(() -> processor.processToWebp(upload("no-extension", "hello".getBytes())))
            .isInstanceOf(InvalidFileTypeException.class);
    }

    /** An interrupted upload: bytes that are no image at all are AccountControllerIT. */
    @Test
    void a_truncated_image_is_an_invalid_type() throws IOException {
        byte[] png = encode(filled(400, 400, BufferedImage.TYPE_INT_RGB, Color.BLUE), "png");

        assertThatThrownBy(() -> processor.processToWebp(upload("photo.png", Arrays.copyOf(png, 60))))
            .isInstanceOf(InvalidFileTypeException.class);
    }

    /** The native WebP reader has no pixel cap of its own; WebP goes through the header-checked CLI path only. */
    @Test
    void webp_bytes_under_another_extension_never_reach_the_native_reader() throws IOException {
        byte[] webp = processor.processToWebp(
            upload("photo.png", encode(filled(500, 500, BufferedImage.TYPE_INT_RGB, Color.RED), "png")));

        assertThatThrownBy(() -> processor.processToWebp(upload("renamed.png", webp)))
            .isInstanceOf(InvalidFileTypeException.class);
    }

    @Test
    void a_canvas_over_the_pixel_limit_is_too_large_even_when_the_file_is_small() throws IOException {
        // 1 bit per pixel compresses to almost nothing; the declared canvas is what decoding would cost.
        byte[] png = encode(new BufferedImage(12_000, 9_000, BufferedImage.TYPE_BYTE_BINARY), "png");
        assertThat((long) png.length).isLessThan(ImageProcessor.MAX_FILE_BYTES);

        assertThatThrownBy(() -> processor.processToWebp(upload("huge.png", png)))
            .isInstanceOf(FileTooLargeException.class);
    }

    /**
     * Only the square the crop keeps is decoded. Subsampling follows the SHORT side, so without the source region a
     * 62500x1599 panorama (under the pixel limit) would be decoded in full, about 400 MB of RGBA for a 400x400 avatar.
     * Here the centre is white and the rest black: a decode of anything but the centre shows up in the corners.
     */
    @Test
    void only_the_centred_square_of_a_panorama_is_decoded() throws IOException {
        BufferedImage panorama = new BufferedImage(10_000, 500, BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g = panorama.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(4_750, 0, 500, 500);
        g.dispose();
        List<BufferedImage> decoded = new ArrayList<>();
        AvatarImageProcessor recording = new AvatarImageProcessor(
            new CliImageDecoder("billet-studio-missing-dwebp", "billet-studio-missing-avifdec")) {
            @Override
            protected BufferedImage process(BufferedImage original) {
                decoded.add(original);
                return super.process(original);
            }
        };

        recording.processToWebp(upload("panorama.png", encode(panorama, "png")));

        BufferedImage square = decoded.getFirst();
        assertThat(square.getWidth()).isEqualTo(500);
        assertThat(square.getHeight()).isEqualTo(500);
        assertThat(new Color(square.getRGB(0, 0)).getRed()).isEqualTo(255);
        assertThat(new Color(square.getRGB(499, 499)).getRed()).isEqualTo(255);
    }

    @Test
    void a_large_photo_is_decoded_straight_to_the_subsampled_square() throws IOException {
        List<BufferedImage> decoded = new ArrayList<>();
        AvatarImageProcessor recording = new AvatarImageProcessor(
            new CliImageDecoder("billet-studio-missing-dwebp", "billet-studio-missing-avifdec")) {
            @Override
            protected BufferedImage process(BufferedImage original) {
                decoded.add(original);
                return super.process(original);
            }
        };

        recording.processToWebp(upload("photo.png",
            encode(new BufferedImage(4_000, 3_000, BufferedImage.TYPE_BYTE_BINARY), "png")));

        assertThat(decoded.getFirst().getWidth()).isEqualTo(1_000);
        assertThat(decoded.getFirst().getHeight()).isEqualTo(1_000);
    }

    /** The cap holds for any processor, also one that asks for the full image at full resolution. */
    @Test
    void a_raster_over_the_decode_cap_is_too_large_before_it_is_allocated() throws IOException {
        ImageProcessor fullSize = new ImageProcessor(
            new CliImageDecoder("billet-studio-missing-dwebp", "billet-studio-missing-avifdec")) {
            @Override
            protected BufferedImage process(BufferedImage original) {
                throw new AssertionError("must not decode");
            }

            @Override
            protected int subsampling(int width, int height) {
                return 1;
            }
        };
        byte[] png = encode(new BufferedImage(5_000, 4_000, BufferedImage.TYPE_BYTE_BINARY), "png");

        assertThatThrownBy(() -> fullSize.processToWebp(upload("big.png", png)))
            .isInstanceOf(FileTooLargeException.class);
    }

    // ---------------------------------------------------------------- decode permits

    @Test
    void the_decode_permit_is_returned_after_success_and_after_failure() throws IOException {
        int free = ImageProcessor.DECODE_PERMITS.availablePermits();

        processor.processToWebp(upload("photo.png", encode(filled(500, 500, BufferedImage.TYPE_INT_RGB,
            Color.RED), "png")));
        assertThatThrownBy(() -> processor.processToWebp(upload("photo.png", "not an image".getBytes())))
            .isInstanceOf(InvalidFileTypeException.class);

        assertThat(ImageProcessor.DECODE_PERMITS.availablePermits()).isEqualTo(free);
    }

    /** A burst of uploads queues for a decode slot instead of decoding side by side. */
    @Test
    void a_decode_waits_while_every_permit_is_taken() throws Exception {
        byte[] png = encode(filled(500, 500, BufferedImage.TYPE_INT_RGB, Color.RED), "png");
        ImageProcessor.DECODE_PERMITS.acquire(ImageProcessor.CONCURRENT_DECODES);
        boolean released = false;
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<byte[]> upload = executor.submit(() -> processor.processToWebp(upload("photo.png", png)));

            assertThatThrownBy(() -> upload.get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);

            ImageProcessor.DECODE_PERMITS.release(ImageProcessor.CONCURRENT_DECODES);
            released = true;
            assertThat(isWebp(upload.get(10, TimeUnit.SECONDS))).isTrue();
        } finally {
            if (!released) {
                ImageProcessor.DECODE_PERMITS.release(ImageProcessor.CONCURRENT_DECODES);
            }
            executor.shutdownNow();
        }
    }

    private static MockMultipartFile upload(String filename, byte[] bytes) {
        return new MockMultipartFile("image", filename, "application/octet-stream", bytes);
    }

    private static BufferedImage filled(int width, int height, int type, Color color) {
        BufferedImage image = new BufferedImage(width, height, type);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, width, height);
        g.dispose();
        return image;
    }

    private static byte[] encode(BufferedImage image, String format) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertThat(ImageIO.write(image, format, out)).as("writer for " + format).isTrue();
        return out.toByteArray();
    }

    private static boolean isWebp(byte[] bytes) {
        return bytes.length > 12
            && new String(bytes, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
            && new String(bytes, 8, 4, StandardCharsets.US_ASCII).equals("WEBP");
    }
}
