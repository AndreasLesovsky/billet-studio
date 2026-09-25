package app.billetstudio.catalog.dto;

public record ModelDto(String slug, String nameDe, String nameEn, String occasion, String fileUrl, String previewUrl,
    Long fileSizeBytes, String credit, boolean active, ModelDefaultsDto defaults) {
}
