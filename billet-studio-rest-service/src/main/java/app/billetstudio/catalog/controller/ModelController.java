package app.billetstudio.catalog.controller;

import java.time.Duration;
import java.util.List;

import app.billetstudio.catalog.dto.ModelDto;
import app.billetstudio.catalog.service.ModelCatalogService;

import lombok.RequiredArgsConstructor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The public model library. Seed changes reach clients within the cache lifetime. */
@RestController
@RequestMapping("/v1/models")
@RequiredArgsConstructor
public class ModelController {

    private static final CacheControl CACHE = CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic();

    private final ModelCatalogService modelCatalogService;

    @GetMapping
    public ResponseEntity<List<ModelDto>> listModels() {
        return ResponseEntity.ok().cacheControl(CACHE).body(modelCatalogService.listActive());
    }

    @GetMapping("/{slug}")
    public ResponseEntity<ModelDto> getModel(@PathVariable String slug) {
        return ResponseEntity.ok().cacheControl(CACHE).body(modelCatalogService.get(slug));
    }
}
