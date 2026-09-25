package app.billetstudio.catalog.dto;

/** The scene values the editor applies when this model is picked. */
public record ModelDefaultsDto(double fitSize, double yOffset, double exposure, double cameraDistance,
    double cameraHeight, double autoRotateSpeed) {
}
