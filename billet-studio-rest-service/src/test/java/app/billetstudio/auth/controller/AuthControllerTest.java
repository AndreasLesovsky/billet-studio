package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;

import app.billetstudio.auth.dto.RegisterRequestDto;
import app.billetstudio.auth.dto.UserResponseDto;
import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.event.UserRegisteredEvent;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.security.JwtUtil;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AuthResult;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.auth.service.UserService;
import app.billetstudio.support.StandaloneMvc;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The auth endpoints' own logic - response shapes, cookie attributes, status codes, rate limits - with the services
 * mocked. The same flows against a real database are AuthControllerIT.
 */
class AuthControllerTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private final UserService userService = mock(UserService.class);
    private final AuthSessionService authSessionService = mock(AuthSessionService.class);
    private final ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);
    private final JwtUtil jwtUtil = new JwtUtil(SECRET, 900_000L, false);

    private final MockMvc mockMvc = StandaloneMvc.of(new AuthController(userService, authSessionService,
        new RefreshCookie(true, "Strict"), jwtUtil, eventPublisher));
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    private static User anne() {
        User user = new User();
        user.setId(7L);
        user.setName("Anne");
        user.setEmail("anne@example.com");
        user.setRole(new Role(1L, Roles.USER, null));
        user.setAvatarUrl("/uploads/avatars/user_7.webp");
        user.setActive(true);
        return user;
    }

    private static AuthSession sessionOf(User user, Duration left) {
        AuthSession session = new AuthSession();
        session.setUser(user);
        session.setIdleExpiresAt(Instant.now().plus(left));
        session.setAbsoluteExpiresAt(Instant.now().plus(Duration.ofDays(90)));
        return session;
    }

    private MvcResult login(String json) throws Exception {
        return mockMvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(json))
            .andReturn();
    }

    private JsonNode body(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    // ---------------------------------------------------------------- login

    @Test
    void login_answersWithTheContractShape_andTheRefreshCookie() throws Exception {
        User anne = anne();
        AuthSession session = sessionOf(anne, Duration.ofDays(14));
        when(userService.authenticate("anne@example.com", "Secret123")).thenReturn(new AuthResult(anne, false));
        when(authSessionService.startSession(anne))
            .thenReturn(new AuthSessionService.IssuedSession("raw-refresh-token", session));
        // A few millis short of three minutes: the frontend counts this down, so it is rounded, not truncated.
        when(authSessionService.remainingFor(session)).thenReturn(Duration.ofMinutes(3).minusMillis(4));

        MvcResult result = login("{\"email\":\"anne@example.com\",\"password\":\"Secret123\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode body = body(result);
        assertThat(body.propertyNames()).containsExactlyInAnyOrder("id", "name", "email", "accessToken", "role",
            "reactivated", "avatarUrl", "expiresInSeconds");
        assertThat(body.get("role").asString()).isEqualTo(Roles.USER);
        assertThat(body.get("reactivated").asBoolean()).isFalse();
        assertThat(body.get("avatarUrl").asString()).isEqualTo("/uploads/avatars/user_7.webp");
        assertThat(body.get("expiresInSeconds").asLong()).isEqualTo(180);
        assertThat(jwtUtil.validateTokenAndGetUserId(body.get("accessToken").asString())).isEqualTo(7L);

        String cookie = result.getResponse().getHeader("Set-Cookie");
        assertThat(cookie).startsWith("refresh_token=raw-refresh-token")
            .contains("Path=/v1/auth").contains("HttpOnly").contains("Secure").contains("SameSite=Strict")
            .contains("Max-Age=");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("raw-refresh-token");
    }

    @Test
    void login_failure_is401_andStartsNoSession() throws Exception {
        when(userService.authenticate(any(), any())).thenThrow(new JwtAuthException());

        MvcResult result = login("{\"email\":\"anne@example.com\",\"password\":\"wrong\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(result).get("errorCode").asString()).isEqualTo("UNAUTHORIZED");
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        verifyNoInteractions(authSessionService);
    }

    /** A malformed request never reaches the account lookup, so it cannot leak account state either. */
    @Test
    void login_withAMalformedEmail_is400_beforeAnyLookup() throws Exception {
        MvcResult result = login("{\"email\":\"not-an-email\",\"password\":\"Secret123\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(result).get("errorCode").asString()).isEqualTo("VALIDATION_ERROR");
        verifyNoInteractions(userService);
    }

    @Test
    void login_eleventhAttemptWithinAQuarterHour_is429() throws Exception {
        when(userService.authenticate(any(), any())).thenThrow(new JwtAuthException());

        for (int i = 0; i < 10; i++) {
            assertThat(login("{\"email\":\"anne@example.com\",\"password\":\"guess\"}").getResponse().getStatus())
                .isEqualTo(401);
        }
        MvcResult blocked = login("{\"email\":\"anne@example.com\",\"password\":\"guess\"}");

        assertThat(blocked.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(blocked).get("errorCode").asString()).isEqualTo("RATE_LIMIT_EXCEEDED");
    }

    // ---------------------------------------------------------------- refresh

    @Test
    void refresh_withoutACookie_is401_andNeverTouchesSessions() throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/auth/refresh")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(result).get("errorCode").asString()).isEqualTo("UNAUTHORIZED");
        verifyNoInteractions(authSessionService);
    }

    @Test
    void refresh_renewsTheSameCookie_andReturnsTheUser() throws Exception {
        User anne = anne();
        AuthSession session = sessionOf(anne, Duration.ofDays(14));
        when(authSessionService.refresh("raw-refresh-token")).thenReturn(session);
        when(authSessionService.remainingFor(session)).thenReturn(Duration.ofDays(14));

        MvcResult result = mockMvc.perform(post("/v1/auth/refresh")
            .cookie(new Cookie(RefreshCookie.NAME, "raw-refresh-token"))).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(body(result).get("email").asString()).isEqualTo("anne@example.com");
        assertThat(body(result).get("expiresInSeconds").asLong()).isEqualTo(Duration.ofDays(14).toSeconds());
        assertThat(result.getResponse().getHeader("Set-Cookie")).startsWith("refresh_token=raw-refresh-token")
            .contains("Max-Age=" + Duration.ofDays(14).toSeconds());
    }

    @Test
    void refresh_ofADeadSession_is401() throws Exception {
        when(authSessionService.refresh("dead")).thenThrow(new JwtAuthException());

        MvcResult result = mockMvc.perform(post("/v1/auth/refresh").cookie(new Cookie(RefreshCookie.NAME, "dead")))
            .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(401);
    }

    // ---------------------------------------------------------------- logout

    @Test
    void logout_endsTheSession_andClearsTheCookieOnItsPath() throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/auth/logout")
            .cookie(new Cookie(RefreshCookie.NAME, "raw-refresh-token"))).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(204);
        verify(authSessionService).endSession("raw-refresh-token");
        // Same name and path, or the browser keeps the old cookie next to the cleared one.
        assertThat(result.getResponse().getHeader("Set-Cookie")).startsWith("refresh_token=;")
            .contains("Path=/v1/auth").contains("Max-Age=0").contains("HttpOnly");
    }

    @Test
    void logout_withoutACookie_isStill204() throws Exception {
        mockMvc.perform(post("/v1/auth/logout")).andExpect(status().isNoContent());

        verify(authSessionService, never()).endSession(any());
    }

    // ---------------------------------------------------------------- register, forgot, reset

    @Test
    void register_is201_withTheUser_andAnnouncesTheSignUp() throws Exception {
        UserResponseDto created = new UserResponseDto(7L, "Anne", "anne@example.com", Roles.USER, "en", null, true,
            false, null, null, null, Instant.now(), Instant.now());
        when(userService.register(new RegisterRequestDto("Anne", "anne@example.com", "Secret123", "en")))
            .thenReturn(created);

        mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Anne\",\"email\":\"anne@example.com\",\"password\":\"Secret123\","
                + "\"preferredLanguage\":\"en\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.role").value(Roles.USER))
            .andExpect(jsonPath("$.id").value(7));

        verify(eventPublisher).publishEvent(new UserRegisteredEvent(7L, "Anne", "anne@example.com"));
        verifyNoInteractions(authSessionService);
    }

    @Test
    void register_withABlankField_is400() throws Exception {
        mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"\",\"email\":\"anne@example.com\",\"password\":\"Secret123\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verifyNoInteractions(userService);
    }

    @Test
    void forgotPassword_answers200_whateverTheServiceFound() throws Exception {
        mockMvc.perform(post("/v1/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
            .content("{\"email\":\"ghost@example.com\"}"))
            .andExpect(status().isOk());

        verify(userService).requestPasswordReset("ghost@example.com");
    }

    @Test
    void resetPassword_is204() throws Exception {
        mockMvc.perform(post("/v1/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
            .content("{\"token\":\"tok\",\"newPassword\":\"Password1\",\"confirmPassword\":\"Password1\"}"))
            .andExpect(status().isNoContent());

        verify(userService).resetPassword("tok", "Password1", "Password1");
    }
}
