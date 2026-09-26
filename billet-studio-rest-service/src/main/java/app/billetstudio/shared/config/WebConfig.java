package app.billetstudio.shared.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

import app.billetstudio.auth.interceptor.RateLimitInterceptor;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.server.MimeMappings;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.server.servlet.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Slf4j
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private static final String MODEL_FILES_PATTERN = "/files/models/**";

    private final RateLimitInterceptor rateLimitInterceptor;

    @Value("${app.upload.directory}")
    private String uploadDirectory;

    @Value("${app.models.directory}")
    private String modelsDirectory;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/uploads/**").addResourceLocations(directoryLocation(uploadDirectory));

        // Blank = the models ship with the Angular app. Never default to a directory: a blank path resolves to the
        // backend's working directory.
        if (!StringUtils.hasText(modelsDirectory)) {
            return;
        }
        if (!Files.isDirectory(Path.of(modelsDirectory))) {
            log.warn("app.models.directory {} is not a directory; every {} request answers 404",
                Path.of(modelsDirectory).toAbsolutePath(), MODEL_FILES_PATTERN);
        }
        registry.addResourceHandler(MODEL_FILES_PATTERN)
            .addResourceLocations(directoryLocation(modelsDirectory))
            // File names are versioned (<slug>.v<n>.glb) and a content change bumps the version: a URL never changes.
            .setCacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
            .resourceChain(false)
            .addResolver(new ModelFileResolver());
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor);
    }

    /** Neither the container's mime table nor Spring's knows .glb; without this a GLB goes out untyped. */
    @Bean
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> modelMimeMappings() {
        return factory -> factory.addMimeMappings(new MimeMappings(Map.of("glb", "model/gltf-binary")));
    }

    /**
     * Absolute file: URI with a trailing slash; a relative "file:./uploads" would resolve against whatever the working
     * directory happens to be, and without the slash the last segment is dropped.
     */
    private static String directoryLocation(String directory) {
        String location = Path.of(directory).toAbsolutePath().normalize().toUri().toString();
        return location.endsWith("/") ? location : location + "/";
    }

    /**
     * Only what the asset pipeline produces: a models directory set one level too high (onto a deployment folder with
     * its .env.production) must still publish nothing else.
     */
    private static final class ModelFileResolver extends PathResourceResolver {

        @Override
        protected Resource getResource(String resourcePath, Resource location) throws IOException {
            return resourcePath.endsWith(".glb") || resourcePath.endsWith(".webp")
                ? super.getResource(resourcePath, location)
                : null;
        }
    }
}
