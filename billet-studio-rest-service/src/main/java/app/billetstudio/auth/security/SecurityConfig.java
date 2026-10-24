package app.billetstudio.auth.security;

import java.util.Arrays;

import jakarta.servlet.DispatcherType;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ContentSecurityPolicyHeaderWriter;
import org.springframework.security.web.header.writers.DelegatingRequestMatcherHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.NegatedRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    // Swagger/OpenAPI: these only resolve when SWAGGER_ENABLED=true (local/dev); otherwise they are 404.
    private static final String[] SWAGGER_PATHS = {"/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**",
        "/v3/api-docs"};

    private final JwtAuthenticationFilter jwtFilter;
    private final CorsConfig corsConfig;
    private final JsonAuthenticationEntryPoint unauthorized;

    public SecurityConfig(JwtAuthenticationFilter jwtFilter, CorsConfig corsConfig,
        JsonAuthenticationEntryPoint unauthorized) {
        this.jwtFilter = jwtFilter;
        this.corsConfig = corsConfig;
        this.unauthorized = unauthorized;
    }

    @Bean
    public BCryptPasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        // Swagger UI serves its own HTML/JS/CSS, which the strict default-src 'none' CSP would block.
        PathPatternRequestMatcher.Builder paths = PathPatternRequestMatcher.withDefaults();
        RequestMatcher swaggerPaths = new OrRequestMatcher(
            Arrays.stream(SWAGGER_PATHS).<RequestMatcher>map(paths::matcher).toList());

        return http
            .cors(cors -> cors.configurationSource(corsConfig.corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // Without these, a request with NO credentials would get Http403ForbiddenEntryPoint's 403, and a
            // denied one an empty sendError(403). The client has to tell those apart: 401 means "refresh and
            // retry", 403 means "never".
            .exceptionHandling(ex -> ex.authenticationEntryPoint(unauthorized).accessDeniedHandler(unauthorized))
            .headers(headers -> headers
                // JSON-only API: forbid the response from loading or framing anything, except on the Swagger
                // UI paths. HSTS is set at the TLS-terminating proxy (Spring only emits it on secure requests).
                .addHeaderWriter(new DelegatingRequestMatcherHeaderWriter(
                    new NegatedRequestMatcher(swaggerPaths),
                    new ContentSecurityPolicyHeaderWriter("default-src 'none'; frame-ancestors 'none'")))
                .addHeaderWriter(new StaticHeadersWriter(
                    "Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()"))
                // Shared billets are private greetings: no search engine may index them, error answers included.
                .addHeaderWriter(new DelegatingRequestMatcherHeaderWriter(paths.matcher("/v1/public/**"),
                    new StaticHeadersWriter("X-Robots-Tag", "noindex"))))
            .authorizeHttpRequests(auth -> auth
                // The container's forward to /error after a sendError (e.g. a request the firewall rejects). It
                // carries no authentication, so a protected /error would turn every such status into a 401.
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(SWAGGER_PATHS).permitAll()
                .requestMatchers("/uploads/**", "/actuator/health").permitAll()
                // Served by WebConfig only while app.models.directory is set; a 404 otherwise.
                .requestMatchers(HttpMethod.GET, "/files/models/**").permitAll()
                // Everything under /v1/auth authorises itself: login by credentials, refresh and logout by
                // the refresh cookie. None of them may require a working access token.
                .requestMatchers("/v1/auth/**").permitAll()
                // Anonymous routes; JwtAuthenticationFilter.isAnonymousRoute skips the token for exactly these.
                .requestMatchers("/v1/public/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/models/**").permitAll()
                .requestMatchers("/v1/assist", "/v1/assist/**").permitAll()
                .requestMatchers("/v1/billets/**").authenticated()
                // Deny before the controller is reached; @PreAuthorize on the controllers is the second gate.
                .requestMatchers("/v1/users/**").hasRole("ADMIN")
                .requestMatchers("/v1/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
