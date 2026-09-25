package app.billetstudio.shared.config;

import java.util.List;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    // The scheme key must match the name the security requirement refers to.
    private static final String BEARER_AUTH = "bearerAuth";

    @Bean
    public OpenAPI customOpenAPI(@Value("${app.version}") String version) {
        return new OpenAPI()
            .info(new Info()
                .title("billet-studio API")
                .version(version)
                .description("billet-studio REST API with JWT authentication"))
            .servers(List.of(new Server().url("http://localhost:8080").description("Local development")))
            .addSecurityItem(new SecurityRequirement().addList(BEARER_AUTH))
            .components(new Components()
                .addSecuritySchemes(BEARER_AUTH, new SecurityScheme()
                    .name(BEARER_AUTH)
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")));
    }
}
