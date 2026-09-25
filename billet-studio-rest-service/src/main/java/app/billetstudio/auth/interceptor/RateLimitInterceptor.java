package app.billetstudio.auth.interceptor;

import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.exception.RateLimitExceededException;
import app.billetstudio.auth.util.ClientIp;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Enforces {@link RateLimited}: one token bucket per client IP and endpoint. The endpoint is the HTTP method
 * plus the matched route pattern, not the raw URI, so /v1/users/5 and /v1/users/6 share one bucket.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class RateLimitInterceptor implements HandlerInterceptor {

    private final Environment environment;
    private final Map<String, Entry> buckets = new ConcurrentHashMap<>();

    /** Off only for the e2e suite; a deployment that never mentions the variable keeps every limit. */
    @Value("${app.rate-limit.enabled:true}")
    private boolean rateLimitEnabled;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!rateLimitEnabled || !(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }
        RateLimited rateLimited = handlerMethod.getMethodAnnotation(RateLimited.class);
        if (rateLimited == null) {
            return true;
        }

        // Rightmost X-Forwarded-For hop = the IP the trusted proxy observed; the leftmost is client-spoofable
        // and must never key the rate limit. See ClientIp for the trust model.
        String clientIp = ClientIp.resolve(request.getHeader("X-Forwarded-For"), request.getRemoteAddr());
        String endpoint = request.getMethod() + " " + routePattern(request);

        AtomicBoolean allowed = new AtomicBoolean();
        // Consumed inside compute: the sweep drops buckets under the same per-key lock, so it cannot drop one between
        // the lookup and the consume and lose the token.
        buckets.compute(clientIp + ":" + endpoint, (key, entry) -> {
            Entry current = entry != null ? entry : new Entry(limitFor(rateLimited));
            allowed.set(current.bucket().tryConsume(1));
            return current;
        });
        if (allowed.get()) {
            return true;
        }
        Limit limit = limitFor(rateLimited);
        log.warn("Rate limit exceeded: ip={}, endpoint={}, limit={} per {}", clientIp, endpoint, limit.capacity(),
            limit.window());
        throw new RateLimitExceededException();
    }

    /** A limit read from configuration is checked at startup, so a malformed value never reaches a request. */
    @EventListener(ApplicationReadyEvent.class)
    public void validateConfiguredLimits(ApplicationReadyEvent event) {
        event.getApplicationContext().getBeansOfType(RequestMappingHandlerMapping.class).values().stream()
            .flatMap(mapping -> mapping.getHandlerMethods().values().stream())
            .map(method -> method.getMethodAnnotation(RateLimited.class))
            .filter(Objects::nonNull)
            .forEach(this::limitFor);
    }

    /**
     * Without it the map keeps one entry per client IP and endpoint for the whole uptime. Only full buckets go: a full
     * bucket answers like a new one, a partly drained one still limits its client.
     */
    @Scheduled(fixedDelay = 10, timeUnit = TimeUnit.MINUTES)
    public void dropRefilledBuckets() {
        buckets.keySet().forEach(key -> buckets.computeIfPresent(key, (k, entry) -> entry.isFull() ? null : entry));
    }

    private record Limit(int capacity, Duration window) {
    }

    private record Entry(Bucket bucket, long capacity) {

        Entry(Limit limit) {
            this(createBucket(limit), limit.capacity());
        }

        boolean isFull() { return bucket.getAvailableTokens() >= capacity; }
    }

    private Limit limitFor(RateLimited rateLimited) {
        if (rateLimited.config().isEmpty()) {
            return new Limit(rateLimited.limit(), Duration.of(rateLimited.duration(), rateLimited.unit()));
        }
        String prefix = rateLimited.config();
        Integer capacity = environment.getRequiredProperty(prefix + ".limit", Integer.class);
        Duration window = DurationStyle.detectAndParse(environment.getRequiredProperty(prefix + ".window"));
        if (capacity < 1 || window.isNegative() || window.isZero()) {
            throw new IllegalStateException(
                "Rate limit " + prefix + " needs limit >= 1 and a positive window, got " + capacity + " / " + window);
        }
        return new Limit(capacity, window);
    }

    private static Bucket createBucket(Limit limit) {
        return Bucket.builder()
            .addLimit(Bandwidth.builder()
                .capacity(limit.capacity())
                .refillIntervally(limit.capacity(), limit.window())
                .build())
            .build();
    }

    private static String routePattern(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        return pattern != null ? pattern.toString() : request.getRequestURI();
    }
}
