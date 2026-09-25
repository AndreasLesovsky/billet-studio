package app.billetstudio.catalog.service;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import app.billetstudio.catalog.dto.ModelDefaultsDto;
import app.billetstudio.catalog.dto.ModelDto;
import app.billetstudio.catalog.entity.ModelAsset;
import app.billetstudio.catalog.exception.ModelNotFoundException;
import app.billetstudio.catalog.repository.ModelAssetRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The model library, read-only. Also resolves the model of a billet for the billet module. */
@Service
@Transactional(readOnly = true)
public class ModelCatalogService {

    private static final Pattern SLUG = Pattern.compile("^[a-z0-9-]{1,60}$");

    private final ModelAssetRepository modelAssetRepository;
    private final String baseUrl;

    public ModelCatalogService(ModelAssetRepository modelAssetRepository,
        @Value("${app.models.base-url}") String baseUrl) {
        this.modelAssetRepository = modelAssetRepository;
        this.baseUrl = stripTrailingSlashes(baseUrl);
    }

    public List<ModelDto> listActive() {
        return modelAssetRepository.findAllByActiveTrueOrderByPositionAscIdAsc().stream().map(this::toDto).toList();
    }

    public ModelDto get(String slug) {
        return find(slug).orElseThrow(ModelNotFoundException::new);
    }

    /** Inactive models included; a string that cannot be a slug is not looked up. */
    public Optional<ModelDto> find(String slug) {
        if (slug == null || !SLUG.matcher(slug).matches()) {
            return Optional.empty();
        }
        return modelAssetRepository.findBySlug(slug).map(this::toDto);
    }

    public boolean exists(String slug) {
        return slug != null && SLUG.matcher(slug).matches() && modelAssetRepository.existsBySlug(slug);
    }

    /** slug -> absolute preview URL, one query for a whole billet list. Unknown slugs are simply absent. */
    public Map<String, String> previewUrls(Collection<String> slugs) {
        if (slugs.isEmpty()) {
            return Map.of();
        }
        return modelAssetRepository.findAllBySlugIn(slugs).stream()
            .collect(Collectors.toMap(ModelAsset::getSlug, model -> resolve(model.getPreviewPath())));
    }

    private ModelDto toDto(ModelAsset model) {
        return new ModelDto(model.getSlug(), model.getNameDe(), model.getNameEn(), model.getOccasion(),
            resolve(model.getFilePath()), resolve(model.getPreviewPath()), model.getFileSizeBytes(), model.getCredit(),
            model.isActive(),
            new ModelDefaultsDto(model.getFitSize().doubleValue(), model.getYOffset().doubleValue(),
                model.getExposure().doubleValue(), model.getCameraDistance().doubleValue(),
                model.getCameraHeight().doubleValue(), model.getAutoRotateSpeed().doubleValue()));
    }

    /** Exactly one '/' between base and path, however either side was written. */
    private String resolve(String relativePath) {
        int start = 0;
        while (start < relativePath.length() && relativePath.charAt(start) == '/') {
            start++;
        }
        return baseUrl + "/" + relativePath.substring(start);
    }

    private static String stripTrailingSlashes(String url) {
        int end = url.length();
        while (end > 0 && url.charAt(end - 1) == '/') {
            end--;
        }
        return url.substring(0, end);
    }
}
