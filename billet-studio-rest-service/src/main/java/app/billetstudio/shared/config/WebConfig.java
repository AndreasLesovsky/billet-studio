package app.billetstudio.shared.config;

import java.nio.file.Path;

import app.billetstudio.auth.interceptor.RateLimitInterceptor;

import lombok.RequiredArgsConstructor;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final RateLimitInterceptor rateLimitInterceptor;

    @Value("${app.upload.directory}")
    private String uploadDirectory;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Absolute file: URI with a trailing slash; a relative "file:./uploads" would resolve against
        // whatever the working directory happens to be, and without the slash the last segment is dropped.
        String location = Path.of(uploadDirectory).toAbsolutePath().normalize().toUri().toString();
        registry.addResourceHandler("/uploads/**")
            .addResourceLocations(location.endsWith("/") ? location : location + "/");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor);
    }
}
