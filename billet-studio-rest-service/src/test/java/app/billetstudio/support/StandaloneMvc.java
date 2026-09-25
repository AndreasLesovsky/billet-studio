package app.billetstudio.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.interceptor.RateLimitInterceptor;
import app.billetstudio.shared.exception.GlobalExceptionHandler;

import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * A controller over MockMvc without a Spring context or a database: the real GlobalExceptionHandler, Bean Validation,
 * the @AuthenticationPrincipal resolver and a live RateLimitInterceptor with the limits application.yml ships. What
 * it does NOT cover is SecurityConfig (which routes need which role) - that is SecurityRoutesIT.
 */
public final class StandaloneMvc {

    private StandaloneMvc() {
    }

    public static MockMvc of(Object controller) {
        return MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
            .addInterceptors(rateLimiter(shippedConfiguration()))
            .build();
    }

    /** Switched on: @Value never reaches an instance built by hand, and the field defaults to off. */
    public static RateLimitInterceptor rateLimiter(MockEnvironment environment) {
        RateLimitInterceptor interceptor = new RateLimitInterceptor(environment);
        ReflectionTestUtils.setField(interceptor, "rateLimitEnabled", true);
        return interceptor;
    }

    /**
     * application.yml as shipped, without the machine's environment variables or .env.local, so every ${VAR:default}
     * resolves to its default.
     */
    public static MockEnvironment shippedConfiguration() {
        MockEnvironment environment = new MockEnvironment();
        try {
            for (PropertySource<?> source : new YamlPropertySourceLoader()
                .load("application.yml", new ClassPathResource("application.yml"))) {
                environment.getPropertySources().addLast(source);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return environment;
    }

    /** What JwtAuthenticationFilter leaves behind for an authenticated request. */
    public static void signIn(User user) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            user, null, List.of(new SimpleGrantedAuthority(user.getRole().getName()))));
    }

    public static void signOut() {
        SecurityContextHolder.clearContext();
    }
}
