package app.billetstudio.shared.storage;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * Hand-built WebP and AVIF headers: exactly the bytes ImageHeaders reads, with an arbitrary canvas size and no image
 * data behind them. A decoder would reject them; the header check must not need one.
 */
final class ImageHeaderBytes {

    private ImageHeaderBytes() {
    }

    /** Extended format: canvas width-1 / height-1 as 24-bit fields. */
    static byte[] webpVp8x(int width, int height) {
        ByteBuffer chunk = le(10).put((byte) 0).put(new byte[3]);
        putU24(chunk, width - 1);
        putU24(chunk, height - 1);
        return riff("VP8X", chunk.array());
    }

    /** Lossless: signature 0x2f, then width-1 / height-1 as 14-bit fields (padded like a real bitstream). */
    static byte[] webpVp8l(int width, int height) {
        int bits = (width - 1) | (height - 1) << 14;
        return riff("VP8L", le(10).put((byte) 0x2f).putInt(bits).array());
    }

    /** Lossy key frame: 3-byte frame tag, start code, 14-bit width and height. */
    static byte[] webpVp8(int width, int height) {
        ByteBuffer chunk = le(10).put(new byte[3]).put((byte) 0x9d).put((byte) 0x01).put((byte) 0x2a);
        chunk.putShort((short) width).putShort((short) height);
        return riff("VP8 ", chunk.array());
    }

    /** ftyp, then meta > iprp > ipco with one ispe per size pair, then an empty mdat. */
    static byte[] avif(long... sizes) {
        ByteArrayOutputStream ispes = new ByteArrayOutputStream();
        for (int i = 0; i < sizes.length; i += 2) {
            ispes.writeBytes(box("ispe", ByteBuffer.allocate(12).putInt(0).putInt((int) sizes[i])
                .putInt((int) sizes[i + 1]).array()));
        }
        byte[] iprp = box("iprp", box("ipco", ispes.toByteArray()));
        byte[] meta = box("meta", concat(new byte[4], box("hdlr", new byte[24]), iprp));
        return concat(box("ftyp", "avif\0\0\0\0mif1avif".getBytes(StandardCharsets.US_ASCII)), meta,
            box("mdat", new byte[0]));
    }

    /** An AVIF whose meta box comes after a large mdat, beyond the header window. */
    static byte[] avifWithMetaAfter(int mdatBytes) {
        return concat(box("ftyp", "avif\0\0\0\0mif1avif".getBytes(StandardCharsets.US_ASCII)),
            box("mdat", new byte[mdatBytes]), avif(64, 64));
    }

    private static ByteBuffer le(int capacity) {
        return ByteBuffer.allocate(capacity).order(ByteOrder.LITTLE_ENDIAN);
    }

    private static void putU24(ByteBuffer buffer, int value) {
        buffer.put((byte) value).put((byte) (value >>> 8)).put((byte) (value >>> 16));
    }

    private static byte[] riff(String fourcc, byte[] chunk) {
        ByteBuffer riff = le(20 + chunk.length);
        riff.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(12 + chunk.length)
            .put("WEBP".getBytes(StandardCharsets.US_ASCII))
            .put(fourcc.getBytes(StandardCharsets.US_ASCII)).putInt(chunk.length).put(chunk);
        return riff.array();
    }

    private static byte[] box(String type, byte[] content) {
        return ByteBuffer.allocate(8 + content.length).putInt(8 + content.length)
            .put(type.getBytes(StandardCharsets.US_ASCII)).put(content).array();
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }
}
