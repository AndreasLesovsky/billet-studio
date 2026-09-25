package app.billetstudio.auth.interceptor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import java.lang.reflect.Method;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.stream.Stream;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.controller.AccountController;
import app.billetstudio.auth.controller.AuthController;
import app.billetstudio.auth.dto.LoginRequestDto;
import app.billetstudio.auth.dto.PasswordChangeDto;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.RateLimitExceededException;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The bucket key, the limits on the endpoints a password can be guessed through, and the startup check of a
 * configured limit. The limit read from configuration end to end (register) is RegisterRateLimitIT; the client IP the
 * key starts with is ClientIpTest.
 */
class RateLimitInterceptorTest {

    private static final String IP = "203.0.113.7";

    /** Two requests per hour - small enough to exhaust in a test. */
    @RateLimited(limit = 2, duration = 1, unit = ChronoUnit.HOURS)
    public void limitedEndpoint() {
    }

    @RateLimited(config = "test.limit")
    public void configuredEndpoint() {
    }

    private final MockEnvironment environment = new MockEnvironment();
    private final MockHttpServletResponse response = new MockHttpServletResponse();

    private RateLimitInterceptor interceptor() {
        RateLimitInterceptor i = new RateLimitInterceptor(environment);
        ReflectionTestUtils.setField(i, "rateLimitEnabled", true);
        return i;
    }

    /** What the DispatcherServlet hands the interceptor: the raw URI plus the route pattern it matched. */
    private static MockHttpServletRequest request(String method, String uri, String pattern) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, pattern);
        request.setRemoteAddr(IP);
        return request;
    }

    /**
     * The key is METHOD + ROUTE: per raw URI every id would be a fresh bucket and /v1/users/{id} had no limit at all;
     * without the method, PUT and DELETE (different limits) would drain each other's bucket.
     */
    @Test
    void theBucketIsKeyedByMethodAndRoutePattern_notByTheRawUri() throws Exception {
        RateLimitInterceptor interceptor = interceptor();
        HandlerMethod handler = new HandlerMethod(this, RateLimitInterceptorTest.class.getMethod("limitedEndpoint"));
        interceptor.preHandle(request("DELETE", "/v1/users/5", "/v1/users/{id}"), response, handler);
        interceptor.preHandle(request("DELETE", "/v1/users/6", "/v1/users/{id}"), response, handler);

        assertThatThrownBy(() -> interceptor.preHandle(request("DELETE", "/v1/users/7", "/v1/users/{id}"),
            response, handler))
            .isInstanceOf(RateLimitExceededException.class);
        assertThat(interceptor.preHandle(request("PUT", "/v1/users/5", "/v1/users/{id}"), response, handler))
            .isTrue();
    }

    static Stream<Arguments> passwordGuessingEndpoints() throws NoSuchMethodException {
        return Stream.of(
            Arguments.of("/v1/auth/login", new HandlerMethod(mock(AuthController.class),
                AuthController.class.getMethod("login", LoginRequestDto.class)), 10),
            Arguments.of("/v1/account/change-password", new HandlerMethod(mock(AccountController.class),
                AccountController.class.getMethod("changePassword", User.class, PasswordChangeDto.class)), 5));
    }

    /** Within one quarter hour: the brute-force limits on the two endpoints that check a password. */
    @ParameterizedTest(name = "{0}: {2} attempts")
    @MethodSource("passwordGuessingEndpoints")
    void aPasswordGuessingEndpoint_refusesTheAttemptPastItsLimit(String route, HandlerMethod handler, int limit)
        throws Exception {
        RateLimitInterceptor interceptor = interceptor();

        for (int i = 0; i < limit; i++) {
            assertThat(interceptor.preHandle(request("POST", route, route), response, handler)).isTrue();
        }
        assertThatThrownBy(() -> interceptor.preHandle(request("POST", route, route), response, handler))
            .isInstanceOf(RateLimitExceededException.class);
    }

    /** Checked at startup: a zero limit would otherwise surface as a 500 on the first request to the endpoint. */
    @Test
    void aZeroConfiguredLimit_stopsTheStartup() throws Exception {
        environment.setProperty("test.limit.limit", "0");
        environment.setProperty("test.limit.window", "7d");

        assertThatThrownBy(() -> interceptor().validateConfiguredLimits(readyEvent()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("test.limit");
    }

    /** A running context whose only mapped handler is {@link #configuredEndpoint()}. */
    private ApplicationReadyEvent readyEvent() throws NoSuchMethodException {
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        Method method = RateLimitInterceptorTest.class.getMethod("configuredEndpoint");
        mapping.registerMapping(RequestMappingInfo.paths("/configured").methods(RequestMethod.POST).build(), this,
            method);

        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("requestMappingHandlerMapping", mapping);
        context.refresh();
        return new ApplicationReadyEvent(new SpringApplication(), new String[0], context, Duration.ZERO);
    }
}
