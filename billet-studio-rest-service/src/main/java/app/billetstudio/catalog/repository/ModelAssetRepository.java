package app.billetstudio.catalog.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import app.billetstudio.catalog.entity.ModelAsset;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ModelAssetRepository extends JpaRepository<ModelAsset, Long> {

    /** The library: active models only; id breaks ties so equal positions keep a stable order. */
    List<ModelAsset> findAllByActiveTrueOrderByPositionAscIdAsc();

    /** Also inactive ones: a retired model still resolves for the billets that use it. */
    Optional<ModelAsset> findBySlug(String slug);

    List<ModelAsset> findAllBySlugIn(Collection<String> slugs);

    boolean existsBySlug(String slug);
}
