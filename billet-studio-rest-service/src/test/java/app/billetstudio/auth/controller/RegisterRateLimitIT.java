package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;

import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The registration limit comes from configuration (app.auth.register-rate-limit, REGISTER_RATE_LIMIT and
 * REGISTER_RATE_LIMIT_WINDOW in production), not from the annotation. Its own context, because it is the one IT
 * that runs with rate limiting switched on.
 */
@Testcontainers(disabledWithoutDocker = true)
@TestPropertySource(properties = {
    "app.rate-limit.enabled=true",
    "app.auth.register-rate-limit.limit=2",
    "app.auth.register-rate-limit.window=1h"
})
class RegisterRateLimitIT extends WebITBase {

    private MvcResult registerFrom(String ip) throws Exception {
        return mockMvc.perform(post("/v1/auth/register")
            .with(request -> {
                request.setRemoteAddr(ip);
                return request;
            })
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("name", "Anne", "email", uniqueEmail("limited"), "password", "Secret123"))))
            .andReturn();
    }

    @Test
    void theConfiguredLimitHoldsPerAddress() throws Exception {
        assertThat(status(registerFrom("198.51.100.7"))).isEqualTo(201);
        assertThat(status(registerFrom("198.51.100.7"))).isEqualTo(201);

        MvcResult third = registerFrom("198.51.100.7");

        assertThat(status(third)).isEqualTo(429);
        assertThat(content(third)).contains("\"errorCode\":\"RATE_LIMIT_EXCEEDED\"");
        assertThat(status(registerFrom("198.51.100.8"))).as("another address has its own allowance").isEqualTo(201);
    }
}
