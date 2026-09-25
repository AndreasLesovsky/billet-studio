package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.shared.util.SecureTokens;
import app.billetstudio.support.WebITBase;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.databind.JsonNode;

/**
 * The auth handshake end to end: login, refresh, logout, registration and the reset link, against the real schema.
 *
 * The no-enumeration rule gets the strictest check: the bodies are compared character for character with only the
 * timestamp stripped, because the leak it guards against is usually an extra field somebody adds later to be
 * helpful. Rate limits are off in this context; RegisterRateLimitIT has them on.
 */
@Testcontainers(disabledWithoutDocker = true)
class AuthControllerIT extends WebITBase {

    private static final String PASSWORD = "Correct-horse-9";
    private static final String NEW_PASSWORD = "Brand-new-pass-2";

    @Value("${app.auth.session.user.idle}")
    private Duration userIdle;
    @Value("${app.auth.session.admin.idle}")
    private Duration adminIdle;

    private User anne(String prefix) {
        return createUser("Anne", uniqueEmail(prefix), PASSWORD, Roles.USER);
    }

    /** Everything but the timestamp, which is the one field that legitimately differs. */
    private static String comparableBody(MvcResult result) throws Exception {
        return content(result).replaceAll("\"timestamp\":\"[^\"]*\"", "\"timestamp\":\"<stripped>\"");
    }

    private long expiresInSeconds(MvcResult result) throws Exception {
        JsonNode expires = body(result).get("expiresInSeconds");
        assertThat(expires).as("the frontend counts this down; without it there is no warning and no logout")
            .isNotNull();
        return expires.asLong();
    }

    private MvcResult postJson(String path, Map<String, ?> json) throws Exception {
        return mockMvc.perform(post(path)
            .contentType(MediaType.APPLICATION_JSON).content(json(json))).andReturn();
    }

    // ---------------------------------------------------------------- no enumeration

    @Test
    void unknownEmail_wrongPassword_adminLock_andPastGrace_areIndistinguishable() throws Exception {
        User active = anne("active");
        User locked = anne("locked");
        locked.setActive(false);
        locked.setDeactivatedAt(Instant.now());
        locked.setDeactivationReason(DeactivationReason.SPAM);
        userRepository.save(locked);
        User pastGrace = anne("pastgrace");
        pastGrace.setActive(false);
        pastGrace.setDeactivatedAt(Instant.now().minus(Duration.ofDays(31)));
        pastGrace.setDeletionScheduledAt(Instant.now().minus(Duration.ofDays(1)));
        userRepository.save(pastGrace);

        MvcResult unknownEmail = login(uniqueEmail("nobody"), PASSWORD);
        MvcResult wrongPassword = login(active.getEmail(), "Not-the-password-1");
        MvcResult adminLocked = login(locked.getEmail(), PASSWORD);
        MvcResult deactivatedPastGrace = login(pastGrace.getEmail(), PASSWORD);

        for (MvcResult result : new MvcResult[]{unknownEmail, wrongPassword, adminLocked, deactivatedPastGrace}) {
            assertThat(status(result)).isEqualTo(401);
            assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        }
        String body = comparableBody(unknownEmail);
        assertThat(body).contains("\"errorCode\":\"UNAUTHORIZED\"");
        assertThat(comparableBody(wrongPassword))
            .withFailMessage("a wrong password must be indistinguishable from an unknown address")
            .isEqualTo(body);
        assertThat(comparableBody(adminLocked))
            .withFailMessage("an admin lock must be indistinguishable from an unknown address")
            .isEqualTo(body);
        assertThat(comparableBody(deactivatedPastGrace))
            .withFailMessage("an account past its grace period must be indistinguishable from an unknown address")
            .isEqualTo(body);

        // The contract's ApiError, and nothing else: an ISO-8601 instant, not epoch numbers.
        JsonNode error = body(unknownEmail);
        assertThat(error.propertyNames()).containsExactlyInAnyOrder("errorCode", "status", "timestamp");
        assertThat(Instant.parse(error.get("timestamp").asString())).isBefore(Instant.now().plusSeconds(1));
        assertThat(reload(pastGrace).isActive()).as("past the grace period nothing reactivates").isFalse();
    }

    // ---------------------------------------------------------------- login, refresh, logout

    @Test
    void correctCredentials_answerWithTheContractShape_andSetTheRefreshCookie() throws Exception {
        User anne = anne("login");

        MvcResult result = login(anne.getEmail(), PASSWORD);

        assertThat(status(result)).isEqualTo(200);
        JsonNode body = body(result);
        assertThat(body.propertyNames()).containsExactlyInAnyOrder("id", "name", "email", "accessToken", "role",
            "reactivated", "avatarUrl", "expiresInSeconds");
        assertThat(body.get("id").asLong()).isEqualTo(anne.getId());
        assertThat(body.get("role").asString()).isEqualTo(Roles.USER);
        assertThat(body.get("reactivated").asBoolean()).isFalse();
        assertThat(body.get("avatarUrl").isNull()).isTrue();
        assertThat(jwtUtil.validateTokenAndGetUserId(body.get("accessToken").asString())).isEqualTo(anne.getId());

        // The half that must never be reachable from JavaScript, and must reach logout as well.
        String cookie = result.getResponse().getHeader("Set-Cookie");
        assertThat(cookie).startsWith("refresh_token=").contains("HttpOnly").contains("Secure")
            .contains("SameSite=Strict").contains("Path=/v1/auth").contains("Max-Age=");
        assertThat(content(result))
            .withFailMessage("the refresh token must never appear in the response body")
            .doesNotContain(refreshCookie(result).getValue());
        assertThat(sessionsOf(anne)).isEqualTo(1);
    }

    @Test
    void loginAndRefresh_reportHowLongTheSessionHasLeft_andTheCookieIsNotRotated() throws Exception {
        User anne = anne("countdown");
        MvcResult loggedIn = login(anne.getEmail(), PASSWORD);

        assertThat(expiresInSeconds(loggedIn)).isBetween(userIdle.toSeconds() - 60, userIdle.toSeconds());

        MvcResult refreshed = refresh(refreshCookie(loggedIn));

        assertThat(status(refreshed)).isEqualTo(200);
        assertThat(body(refreshed).get("email").asString()).isEqualTo(anne.getEmail());
        assertThat(expiresInSeconds(refreshed)).isBetween(userIdle.toSeconds() - 60, userIdle.toSeconds());
        assertThat(refreshCookie(refreshed).getValue()).isEqualTo(refreshCookie(loggedIn).getValue());
        assertThat(sessionsOf(anne)).isEqualTo(1);
    }

    @Test
    void anAdminSession_getsTheShortIdleWindow() throws Exception {
        MvcResult result = login(ROOT_EMAIL, ROOT_PASSWORD);

        assertThat(status(result)).isEqualTo(200);
        assertThat(body(result).get("role").asString()).isEqualTo(Roles.ADMIN);
        assertThat(expiresInSeconds(result)).isBetween(adminIdle.toSeconds() - 60, adminIdle.toSeconds());
    }

    @Test
    void refreshWithoutACookie_is401() throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/auth/refresh")).andReturn();

        assertThat(status(result)).isEqualTo(401);
        assertThat(content(result)).contains("\"errorCode\":\"UNAUTHORIZED\"");
    }

    @Test
    void logout_deletesTheSession_soTheCookieIsDeadEverywhere() throws Exception {
        User anne = anne("logout");
        Cookie cookie = refreshCookie(login(anne.getEmail(), PASSWORD));

        MvcResult loggedOut = mockMvc.perform(post("/v1/auth/logout").cookie(cookie)).andReturn();

        assertThat(status(loggedOut)).isEqualTo(204);
        assertThat(loggedOut.getResponse().getHeader("Set-Cookie")).startsWith("refresh_token=;")
            .contains("Max-Age=0").contains("Path=/v1/auth");
        assertThat(sessionsOf(anne)).isZero();
        // A copy of the cookie kept by an attacker is worth nothing either.
        assertThat(status(refresh(cookie))).isEqualTo(401);
    }

    @Test
    void logout_endsOnlyThisDevice() throws Exception {
        User anne = anne("devices");
        Cookie laptop = refreshCookie(login(anne.getEmail(), PASSWORD));
        Cookie phone = refreshCookie(login(anne.getEmail(), PASSWORD));

        mockMvc.perform(post("/v1/auth/logout").cookie(laptop));

        assertThat(status(refresh(laptop))).isEqualTo(401);
        assertThat(status(refresh(phone))).isEqualTo(200);
    }

    /** The handshake is authorised by the cookie: a dead access token riding along must not break it. */
    @Test
    void theHandshake_ignoresADeadAccessToken() throws Exception {
        User anne = anne("handshake");
        Cookie cookie = refreshCookie(login(anne.getEmail(), PASSWORD));

        MvcResult refreshed = mockMvc.perform(post("/v1/auth/refresh").cookie(cookie)
            .header("Authorization", "Bearer expired-or-garbage")).andReturn();
        MvcResult loggedOut = mockMvc.perform(post("/v1/auth/logout").cookie(cookie)
            .header("Authorization", "Bearer expired-or-garbage")).andReturn();

        assertThat(status(refreshed)).isEqualTo(200);
        assertThat(status(loggedOut)).isEqualTo(204);
    }

    @Test
    void aLoginWithinTheGracePeriod_reactivatesTheAccount() throws Exception {
        User leaving = anne("leaving");
        leaving.setActive(false);
        leaving.setDeactivatedAt(Instant.now().minus(Duration.ofDays(3)));
        leaving.setDeletionScheduledAt(Instant.now().plus(Duration.ofDays(27)));
        leaving.setDeactivationReason(DeactivationReason.OTHER);
        userRepository.save(leaving);

        MvcResult result = login(leaving.getEmail(), PASSWORD);

        assertThat(status(result)).isEqualTo(200);
        assertThat(body(result).get("reactivated").asBoolean()).isTrue();
        User back = reload(leaving);
        assertThat(back.isActive()).isTrue();
        assertThat(back.getDeactivatedAt()).isNull();
        assertThat(back.getDeletionScheduledAt()).isNull();
        assertThat(back.getDeactivationReason()).isNull();
        verify(authMailer).sendAccountDeletionCancelled(new MailRecipient(leaving.getEmail(), "Anne", "de"));
    }

    // ---------------------------------------------------------------- registration

    @Test
    void register_createsARoleUser_evenWhenTheBodyAsksForMore() throws Exception {
        String email = uniqueEmail("signup");

        MvcResult result = postJson("/v1/auth/register", Map.of("name", "Anne", "email", email, "password", "Secret123",
            "preferredLanguage", "en", "role", Roles.ADMIN));

        assertThat(status(result)).isEqualTo(201);
        JsonNode body = body(result);
        assertThat(body.propertyNames()).containsExactlyInAnyOrder("id", "name", "email", "role",
            "preferredLanguage", "avatarUrl", "active", "protectedAccount", "deactivatedAt", "deletionScheduledAt",
            "deactivationReason", "createdAt", "updatedAt");
        assertThat(body.get("role").asString()).isEqualTo(Roles.USER);
        assertThat(body.get("preferredLanguage").asString()).isEqualTo("en");
        assertThat(body.get("active").asBoolean()).isTrue();
        assertThat(body.get("protectedAccount").asBoolean()).isFalse();
        assertThat(Instant.parse(body.get("createdAt").asString())).isNotNull();
        assertThat(userRepository.findByEmail(email).orElseThrow().getRole().getName()).isEqualTo(Roles.USER);
        // No auto-login: the client logs in afterwards.
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        verify(authMailer).sendWelcome(new MailRecipient(email, "Anne", "en"));
    }

    @Test
    void register_twiceWithOneEmail_is409() throws Exception {
        String email = uniqueEmail("twice");
        Map<String, String> signUp = Map.of("name", "Anne", "email", email, "password", "Secret123");

        assertThat(status(postJson("/v1/auth/register", signUp))).isEqualTo(201);
        MvcResult again = postJson("/v1/auth/register", signUp);

        assertThat(status(again)).isEqualTo(409);
        assertThat(content(again)).contains("\"errorCode\":\"EMAIL_ALREADY_EXISTS\"");
    }

    @Test
    void register_withAWeakPassword_is400_andCreatesNothing() throws Exception {
        String email = uniqueEmail("weak");

        MvcResult result = postJson("/v1/auth/register",
            Map.of("name", "Anne", "email", email, "password", "password"));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"VALIDATION_ERROR\"");
        assertThat(userRepository.findByEmail(email)).isEmpty();
    }

    // ---------------------------------------------------------------- password reset

    private String resetTokenMailedTo(String email) {
        ArgumentCaptor<String> link = ArgumentCaptor.forClass(String.class);
        verify(authMailer).sendPasswordReset(argThat(recipient -> recipient.email().equals(email)), link.capture());
        assertThat(link.getValue()).startsWith(FRONTEND_URL + "/reset-password?token=");
        return link.getValue().substring(link.getValue().indexOf("token=") + "token=".length());
    }

    @Test
    void forgotPassword_answersTheSame_forKnownAndUnknownAddresses() throws Exception {
        User anne = anne("forgot");

        MvcResult known = postJson("/v1/auth/forgot-password", Map.of("email", anne.getEmail()));
        MvcResult unknown = postJson("/v1/auth/forgot-password", Map.of("email", uniqueEmail("ghost")));

        assertThat(status(known)).isEqualTo(200);
        assertThat(status(unknown)).isEqualTo(200);
        assertThat(content(known)).isEqualTo(content(unknown));
        verify(authMailer, times(1)).sendPasswordReset(any(), any());
    }

    @Test
    void forgotPassword_forTheRootAccount_issuesNoLink() throws Exception {
        MvcResult result = postJson("/v1/auth/forgot-password", Map.of("email", ROOT_EMAIL));

        assertThat(status(result)).isEqualTo(200);
        verify(authMailer, never()).sendPasswordReset(any(), any());
        assertThat(root().getResetTokenHash()).isNull();
    }

    @Test
    void aResetLink_replacesThePassword_endsEverySession_andWorksOnce() throws Exception {
        User anne = anne("reset");
        Cookie before = refreshCookie(login(anne.getEmail(), PASSWORD));
        postJson("/v1/auth/forgot-password", Map.of("email", anne.getEmail()));
        String token = resetTokenMailedTo(anne.getEmail());

        assertThat(reload(anne).getResetTokenHash()).as("only the hash is stored")
            .isEqualTo(SecureTokens.sha256Hex(token));

        MvcResult reset = postJson("/v1/auth/reset-password",
            Map.of("token", token, "newPassword", NEW_PASSWORD, "confirmPassword", NEW_PASSWORD));

        assertThat(status(reset)).isEqualTo(204);
        assertThat(status(refresh(before))).as("the session from before the reset").isEqualTo(401);
        assertThat(status(login(anne.getEmail(), PASSWORD))).isEqualTo(401);
        assertThat(status(login(anne.getEmail(), NEW_PASSWORD))).isEqualTo(200);

        MvcResult replay = postJson("/v1/auth/reset-password",
            Map.of("token", token, "newPassword", "Third-pass-3", "confirmPassword", "Third-pass-3"));
        assertThat(status(replay)).isEqualTo(400);
        assertThat(content(replay)).contains("\"errorCode\":\"INVALID_TOKEN\"");
    }

    /** The token is cleared on the way to the refusal, and that write has to survive the refusal. */
    @Test
    void anExpiredResetToken_isRefused_andCleared() throws Exception {
        User anne = anne("expired");
        postJson("/v1/auth/forgot-password", Map.of("email", anne.getEmail()));
        String token = resetTokenMailedTo(anne.getEmail());
        User pending = reload(anne);
        pending.setResetTokenExpiry(Instant.now().minus(Duration.ofMinutes(1)));
        userRepository.save(pending);

        MvcResult result = postJson("/v1/auth/reset-password",
            Map.of("token", token, "newPassword", NEW_PASSWORD, "confirmPassword", NEW_PASSWORD));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"TOKEN_EXPIRED\"");
        assertThat(reload(anne).getResetTokenHash()).isNull();
        assertThat(reload(anne).getResetTokenExpiry()).isNull();
        assertThat(status(login(anne.getEmail(), PASSWORD))).as("the old password still works").isEqualTo(200);
    }

    @Test
    void aResetWithMismatchedPasswords_isRefused_andKeepsTheToken() throws Exception {
        User anne = anne("mismatch");
        postJson("/v1/auth/forgot-password", Map.of("email", anne.getEmail()));
        String token = resetTokenMailedTo(anne.getEmail());

        MvcResult result = postJson("/v1/auth/reset-password",
            Map.of("token", token, "newPassword", NEW_PASSWORD, "confirmPassword", "Something-else-4"));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"PASSWORD_MISMATCH\"");
        assertThat(reload(anne).getResetTokenHash()).isEqualTo(SecureTokens.sha256Hex(token));
    }
}
