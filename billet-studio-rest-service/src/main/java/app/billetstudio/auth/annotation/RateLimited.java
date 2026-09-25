package app.billetstudio.auth.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.temporal.ChronoUnit;

/**
 * Per-client-IP rate limit on a controller method, enforced by RateLimitInterceptor.
 *
 * <pre>
 * &#64;RateLimited(limit = 10, duration = 15, unit = ChronoUnit.MINUTES)
 * &#64;RateLimited(config = "app.auth.register-rate-limit")
 * </pre>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimited {

    /** Maximum number of requests allowed within the window. */
    int limit() default 3;

    /** Length of the window, in {@link #unit()}. */
    int duration() default 7;

    ChronoUnit unit() default ChronoUnit.DAYS;

    /**
     * Property prefix that holds the limit instead: {@code <config>.limit} (int) and {@code <config>.window}
     * (a Spring Boot duration such as 7d). When set, limit, duration and unit are ignored.
     */
    String config() default "";
}
