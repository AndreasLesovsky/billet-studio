package app.billetstudio.shared.storage;

import java.awt.Rectangle;
import java.awt.image.BufferedImage;

import org.imgscalr.Scalr;
import org.springframework.stereotype.Component;

/**
 * User avatars: center-crop to a square (cover), then resize to 400x400. Avatars always render round in the
 * frontend, so cropping is the right fit.
 */
@Component
public class AvatarImageProcessor extends ImageProcessor {

    static final int SIZE = 400;

    public AvatarImageProcessor(CliImageDecoder cliDecoder) {
        super(cliDecoder);
    }

    @Override
    protected BufferedImage process(BufferedImage original) {
        int side = Math.min(original.getWidth(), original.getHeight());
        BufferedImage square = original.getSubimage((original.getWidth() - side) / 2,
            (original.getHeight() - side) / 2, side, side);
        // QUALITY scales down in halving steps; one bilinear step from a large photo aliases visibly.
        return Scalr.resize(square, Scalr.Method.QUALITY, Scalr.Mode.FIT_EXACT, SIZE, SIZE);
    }

    /** The same centred square process() crops to, so decode memory follows that square, not the aspect ratio. */
    @Override
    protected Rectangle sourceRegion(int width, int height) {
        int side = Math.min(width, height);
        return new Rectangle((width - side) / 2, (height - side) / 2, side, side);
    }

    /** A large photo decodes with a short side of 2x to 4x the target: bounded memory, still a clean downscale. */
    @Override
    protected int subsampling(int width, int height) {
        return Math.max(1, Math.min(width, height) / (2 * SIZE));
    }
}
