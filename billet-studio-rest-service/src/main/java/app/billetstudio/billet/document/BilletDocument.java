package app.billetstudio.billet.document;

import java.util.List;

import app.billetstudio.billet.document.validation.NoControlCharacters;
import app.billetstudio.billet.document.validation.ValidBilletDocument;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * The billet, mirroring docs/billet-document.md 1:1 (the frontend's billet-document.ts mirrors the same file).
 * Enum-like values stay strings so an unknown value is a VALIDATION_ERROR rather than an unreadable body.
 * schemaVersion is not constrained here: BilletService answers any other version with UNSUPPORTED_SCHEMA_VERSION
 * before the constraints run.
 */
@ValidBilletDocument
public record BilletDocument(
    @NotNull Integer schemaVersion,
    @NotNull @Pattern(regexp = "^[a-z0-9-]{1,40}$") String theme,
    @NotNull @NoControlCharacters @Size(min = 1, max = 120) String title,
    @NotNull @NoControlCharacters @Size(max = 120) String pageTitle,
    @NotNull @Pattern(regexp = "^(de|en)$") String lang,
    @NotNull @Pattern(regexp = "^(auto|light|dark)$") String colorMode,
    @NotNull @Valid Palettes palette,
    @NotNull @Valid Typography typography,
    @NotNull @Valid Spacing spacing,
    @NotNull @Valid Hero hero,
    @NotNull @Valid Scene scene,
    @NotNull @Valid Divider divider,
    @NotNull @Size(max = 30) List<@NotNull @Valid BilletBlock> blocks,
    @NotNull @Valid Signature signature,
    @NotNull @Valid Particles particles) {

    public static final int CURRENT_SCHEMA_VERSION = 1;

    static final String HEX_COLOR = "^#[0-9a-fA-F]{6}$";
    static final String DIVIDER_STYLE = "^(diamond|dot|heart|star|line|none)$";

    public BilletDocument withTitle(String newTitle) {
        return new BilletDocument(schemaVersion, theme, newTitle, pageTitle, lang, colorMode, palette, typography,
            spacing, hero, scene, divider, blocks, signature, particles);
    }
}
