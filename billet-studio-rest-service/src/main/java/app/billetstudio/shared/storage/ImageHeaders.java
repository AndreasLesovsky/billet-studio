package app.billetstudio.shared.storage;

import java.nio.charset.StandardCharsets;

import org.jspecify.annotations.Nullable;

/**
 * The canvas size a WebP or AVIF file declares in its first bytes, read before a CLI decoder allocates that
 * canvas. -1 means no size was found; the caller refuses such a file rather than decode it blind.
 */
final class ImageHeaders {

    /** Enough for the AVIF meta box of real encoders; one placed after the image data is refused. */
    static final int WINDOW_BYTES = 256 * 1024;

    private ImageHeaders() {
    }

    /** RIFF container, then one of the three bitstream chunks (lossy VP8, lossless VP8L, extended VP8X). */
    static long webpPixels(byte[] head) {
        if (head.length < 30 || !isAscii(head, 0, "RIFF") || !isAscii(head, 8, "WEBP")) {
            return -1;
        }
        if (isAscii(head, 12, "VP8X")) {
            // Canvas width-1 and height-1, 24 bits each.
            return (u24le(head, 24) + 1) * (u24le(head, 27) + 1);
        }
        if (isAscii(head, 12, "VP8L")) {
            if ((head[20] & 0xff) != 0x2f) {
                return -1;
            }
            // Width-1 and height-1, 14 bits each, packed little-endian after the signature byte.
            long bits = u24le(head, 21) | (long) (head[24] & 0xff) << 24;
            return ((bits & 0x3fff) + 1) * ((bits >>> 14 & 0x3fff) + 1);
        }
        if (isAscii(head, 12, "VP8 ")) {
            // Key frame: 3-byte frame tag, start code 9d 01 2a, then 14-bit width and height (2 scale bits each).
            if ((head[23] & 0xff) != 0x9d || (head[24] & 0xff) != 0x01 || (head[25] & 0xff) != 0x2a) {
                return -1;
            }
            return (u16le(head, 26) & 0x3fff) * (u16le(head, 28) & 0x3fff);
        }
        return -1;
    }

    /**
     * The largest ispe (image spatial extents) property in meta/iprp/ipco. A grid image lists its tiles and the
     * whole canvas there, so the largest one bounds what the decoder allocates.
     */
    static long avifPixels(byte[] head) {
        Box meta = child(head, 0, head.length, "meta");
        // meta is a full box: version and flags precede its children.
        Box iprp = meta == null ? null : child(head, meta.contentStart() + 4, meta.end(), "iprp");
        Box ipco = iprp == null ? null : child(head, iprp.contentStart(), iprp.end(), "ipco");
        if (ipco == null) {
            return -1;
        }
        long largest = -1;
        for (int at = ipco.contentStart(); at < ipco.end();) {
            Box box = boxAt(head, at, ipco.end());
            if (box == null) {
                return -1;
            }
            if (box.type().equals("ispe") && box.end() - box.contentStart() >= 12) {
                long width = u32be(head, box.contentStart() + 4);
                long height = u32be(head, box.contentStart() + 8);
                largest = Math.max(largest, height != 0 && width > Long.MAX_VALUE / height
                    ? Long.MAX_VALUE
                    : width * height);
            }
            at = box.end();
        }
        return largest;
    }

    private record Box(String type, int contentStart, int end) {
    }

    /** The first box of the type in head[from, to), or null when there is none or it does not end inside. */
    private static @Nullable Box child(byte[] head, int from, int to, String type) {
        for (int at = from;;) {
            Box box = boxAt(head, at, to);
            if (box == null || box.type().equals(type)) {
                return box;
            }
            at = box.end();
        }
    }

    /** ISO BMFF box header: 32-bit size (1 = 64-bit size follows, 0 = to the end of the parent), 4-char type. */
    private static @Nullable Box boxAt(byte[] head, int at, int to) {
        if (at + 8 > to) {
            return null;
        }
        long size = u32be(head, at);
        int header = 8;
        if (size == 1) {
            if (at + 16 > to) {
                return null;
            }
            size = u32be(head, at + 8) << 32 | u32be(head, at + 12);
            header = 16;
        } else if (size == 0) {
            size = to - at;
        }
        if (size < header || size > to - at) {
            return null;
        }
        return new Box(new String(head, at + 4, 4, StandardCharsets.US_ASCII), at + header, at + (int) size);
    }

    private static boolean isAscii(byte[] head, int at, String text) {
        return new String(head, at, text.length(), StandardCharsets.US_ASCII).equals(text);
    }

    private static long u16le(byte[] head, int at) {
        return (head[at] & 0xff) | (head[at + 1] & 0xff) << 8;
    }

    private static long u24le(byte[] head, int at) {
        return u16le(head, at) | (long) (head[at + 2] & 0xff) << 16;
    }

    private static long u32be(byte[] head, int at) {
        return (long) (head[at] & 0xff) << 24 | (head[at + 1] & 0xff) << 16 | (head[at + 2] & 0xff) << 8
            | head[at + 3] & 0xff;
    }
}
