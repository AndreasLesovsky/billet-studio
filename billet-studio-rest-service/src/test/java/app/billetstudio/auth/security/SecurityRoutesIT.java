package app.billetstudio.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * SecurityConfig decides for every URL whether it needs a login and whether it needs ADMIN, and a mistake there is a
 * silent hole - the endpoint keeps working, it just answers to the wrong people.
 *
 * The tables below are the intent, written out: /v1/auth/**, /v1/public/**, GET /v1/models/**, /uploads/** and the
 * health check are public; /v1/users/** is ADMIN; everything else needs a login. They assert the CLASSIFICATION of
 * each rule group, not what the handler returns: "denied" is 401/403, everything else (200, 204, 400, 404, 405)
 * counts as "reached", because whether a controller then likes the request is not this file's business. Routes of
 * phase P2 (billets, models, public billets) are in the table before their controllers exist: an unknown route that
 * gets past security is a 404, one that does not is a 401.
 */
@Testcontainers(disabledWithoutDocker = true)
class SecurityRoutesIT extends WebITBase {

    private static final String USER_EMAIL = uniqueEmail("routes");

    private String userToken;
    private String adminToken;

    @BeforeEach
    void mintTokens() {
        // RootUserBootstrap created the protected root admin on context start.
        adminToken = jwtUtil.generateToken(root().getId());
        User user = userRepository.findByEmail(USER_EMAIL)
            .orElseGet(() -> createUser("Route", USER_EMAIL, "Irrelevant-1", Roles.USER));
        userToken = jwtUtil.generateToken(user.getId());
    }

    private int status(MockHttpServletRequestBuilder request, String token) throws Exception {
        if (token != null) {
            request = request.header("Authorization", "Bearer " + token);
        }
        return mockMvc.perform(request).andReturn().getResponse().getStatus();
    }

    private static boolean isDenied(int status) {
        return status == 401 || status == 403;
    }

    private static MockHttpServletRequestBuilder request(String method, String path) {
        return MockMvcRequestBuilders.request(HttpMethod.valueOf(method), path);
    }

    @ParameterizedTest(name = "public: {0} {1}")
    @CsvSource({
        "POST,   /v1/auth/login",
        "POST,   /v1/auth/register",
        "POST,   /v1/auth/forgot-password",
        "POST,   /v1/auth/reset-password",
        "POST,   /v1/auth/logout",
        "GET,    /v1/public/billets/aaaaaaaaaaaaaaaaaaaaaa",
        "GET,    /v1/models",
        "GET,    /v1/models/bouquet",
        "GET,    /uploads/avatars/nothing.webp",
        "GET,    /actuator/health",
        "GET,    /v3/api-docs"
    })
    void publicRoutes_areReachableWithoutAToken(String method, String path) throws Exception {
        int status = status(request(method, path), null);
        assertThat(isDenied(status))
            .withFailMessage("%s %s must be public but answered %d", method, path, status)
            .isFalse();
    }

    @ParameterizedTest(name = "login required: {0} {1}")
    @CsvSource({
        "GET,    /v1/account",
        "PUT,    /v1/account",
        "POST,   /v1/account/change-password",
        "POST,   /v1/account/deactivate",
        "POST,   /v1/account/avatar",
        "DELETE, /v1/account/avatar",
        "GET,    /v1/billets",
        "POST,   /v1/billets",
        "POST,   /v1/billets/import",
        "POST,   /v1/models",
        "DELETE, /v1/models/bouquet",
        "GET,    /v1/anything-else",
        "GET,    /v1/users"
    })
    void protectedRoutes_areDeniedWithoutAToken(String method, String path) throws Exception {
        // 401, not 403: missing credentials are not the same as insufficient ones, and the client acts on the
        // difference - 401 means "refresh and retry", 403 means "retrying never helps". JsonAuthenticationEntryPoint
        // is what makes this hold; without it Spring Security falls back to Http403ForbiddenEntryPoint.
        int status = status(request(method, path), null);
        assertThat(status)
            .withFailMessage("%s %s must require a login but answered %d", method, path, status)
            .isEqualTo(401);
    }

    @ParameterizedTest(name = "open to a signed-in user: {0} {1}")
    @CsvSource({
        "GET, /v1/account",
        "GET, /v1/billets",
        "GET, /v1/anything-else"
    })
    void protectedRoutes_areReachableForAUser(String method, String path) throws Exception {
        int status = status(request(method, path), userToken);
        assertThat(isDenied(status))
            .withFailMessage("%s %s must be open to a signed-in user but answered %d", method, path, status)
            .isFalse();
    }

    @ParameterizedTest(name = "admin only: {0} {1}")
    @CsvSource({
        "GET,    /v1/users",
        "GET,    /v1/users/roles",
        "GET,    /v1/users/1",
        "POST,   /v1/users",
        "PUT,    /v1/users/1",
        "PATCH,  /v1/users/1/active",
        "DELETE, /v1/users/1"
    })
    void adminRoutes_areForbiddenForAUser(String method, String path) throws Exception {
        MvcResult result = mockMvc.perform(request(method, path).header("Authorization", "Bearer " + userToken))
            .andReturn();
        int status = status(result);
        assertThat(status)
            .withFailMessage("%s %s must be ADMIN-only but answered %d for a user", method, path, status)
            .isEqualTo(403);
        // The URL rule denies before any controller runs: this body comes from the security chain's handler.
        assertThat(content(result)).contains("\"errorCode\":\"ACCESS_DENIED\"");
    }

    @ParameterizedTest(name = "admin only, reachable for an admin: {0} {1}")
    @CsvSource({
        "GET, /v1/users",
        "GET, /v1/users/roles",
        "GET, /v1/account"
    })
    void adminRoutes_areReachableForAnAdmin(String method, String path) throws Exception {
        int status = status(request(method, path), adminToken);
        assertThat(isDenied(status))
            .withFailMessage("%s %s must be reachable for an admin but answered %d", method, path, status)
            .isFalse();
    }

    /** Framework errors keep the contract's ApiError shape through the whole stack, security filters included. */
    @Test
    void unknownRoute_wrongMethod_andMalformedJson_answerWithApiErrors() throws Exception {
        MvcResult unknown = mockMvc.perform(get("/v1/nothing-here").header("Authorization", "Bearer " + userToken))
            .andReturn();
        MvcResult wrongMethod = mockMvc.perform(put("/v1/auth/login")).andReturn();
        MvcResult malformed = mockMvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":")).andReturn();

        assertThat(unknown.getResponse().getStatus()).isEqualTo(404);
        assertThat(content(unknown)).contains("\"errorCode\":\"NOT_FOUND\"");
        assertThat(wrongMethod.getResponse().getStatus()).isEqualTo(405);
        assertThat(content(wrongMethod)).contains("\"errorCode\":\"METHOD_NOT_ALLOWED\"");
        assertThat(malformed.getResponse().getStatus()).isEqualTo(400);
        assertThat(content(malformed)).contains("\"errorCode\":\"MALFORMED_REQUEST\"");
    }
}
