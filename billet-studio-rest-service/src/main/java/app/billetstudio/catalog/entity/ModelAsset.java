package app.billetstudio.catalog.entity;

import java.math.BigDecimal;
import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import org.hibernate.annotations.Immutable;

/**
 * One 3D model of the library (tbl_models). The rows come from seed_models.sql only, so the application never
 * writes them. Paths are relative to app.models.base-url (ModelCatalogService resolves them).
 */
@Entity
@Immutable
@Table(name = "tbl_models")
@Getter
@Setter
@NoArgsConstructor
public class ModelAsset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(columnDefinition = "BIGINT UNSIGNED")
    private Long id;

    @Column(nullable = false, length = 60, unique = true)
    private String slug;

    @Column(name = "name_de", nullable = false, length = 100)
    private String nameDe;

    @Column(name = "name_en", nullable = false, length = 100)
    private String nameEn;

    @Column(nullable = false, length = 30)
    private String occasion;

    @Column(name = "file_path", nullable = false, length = 255)
    private String filePath;

    @Column(name = "preview_path", nullable = false, length = 255)
    private String previewPath;

    @Column(name = "file_size_bytes", nullable = false, columnDefinition = "INT UNSIGNED")
    private Long fileSizeBytes;

    @Column(name = "fit_size", nullable = false, precision = 4, scale = 2)
    private BigDecimal fitSize;

    @Column(name = "y_offset", nullable = false, precision = 4, scale = 2)
    private BigDecimal yOffset;

    @Column(nullable = false, precision = 4, scale = 2)
    private BigDecimal exposure;

    @Column(name = "camera_distance", nullable = false, precision = 4, scale = 2)
    private BigDecimal cameraDistance;

    @Column(name = "camera_height", nullable = false, precision = 4, scale = 2)
    private BigDecimal cameraHeight;

    @Column(name = "auto_rotate_speed", nullable = false, precision = 4, scale = 2)
    private BigDecimal autoRotateSpeed;

    @Column(length = 255)
    private String credit;

    @Column(nullable = false, columnDefinition = "SMALLINT UNSIGNED")
    private Integer position;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
