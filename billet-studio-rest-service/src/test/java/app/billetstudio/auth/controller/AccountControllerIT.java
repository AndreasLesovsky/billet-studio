package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;

import javax.imageio.ImageIO;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.support.WebITBase;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * /v1/account against the real schema: what change-password and deactivate do to the session rows, and the avatar
 * file on disk. The change-password rate limit is RateLimitInterceptorTest.
 */
@Testcontainers(disabledWithoutDocker = true)
class AccountControllerIT extends WebITBase {

    private static final String PASSWORD = "Correct-horse-9";
    private static final String NEW_PASSWORD = "Brand-new-pass-2";

    /** One device's login: the access token it holds in memory and its refresh cookie. */
    private record Device(String bearer, Cookie cookie) {
    }

    private User anne(String prefix) {
        return createUser("Anne", uniqueEmail(prefix), PASSWORD, Roles.USER);
    }

    private Device signIn(String email, String password) throws Exception {
        MvcResult result = login(email, password);
        assertThat(status(result)).as("login of " + email).isEqualTo(200);
        return new Device("Bearer " + body(result).get("accessToken").asString(), refreshCookie(result));
    }

    private MvcResult postJson(Device device, String path, Map<String, ?> json) throws Exception {
        return mockMvc.perform(post(path).header(HttpHeaders.AUTHORIZATION, device.bearer())
            .contentType(MediaType.APPLICATION_JSON).content(json(json))).andReturn();
    }

    private MvcResult changePassword(Device device, String current, String next) throws Exception {
        return postJson(device, "/v1/account/change-password",
            Map.of("currentPassword", current, "newPassword", next, "confirmPassword", next));
    }

    // ---------------------------------------------------------------- profile

    private MvcResult updateAccount(User user, String name, String language) throws Exception {
        return mockMvc.perform(put("/v1/account").header(HttpHeaders.AUTHORIZATION, bearer(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("name", name, "preferredLanguage", language)))).andReturn();
    }

    /** The name rule (UserNameRulesTest) holds on this write path too; a valid edit reaches the row. */
    @Test
    void updateAccount_refusesAnInvalidName_andWritesAValidNameAndLanguage() throws Exception {
        User anne = anne("rename");

        MvcResult refused = updateAccount(anne, "andi99", "de");

        assertThat(status(refused)).isEqualTo(400);
        assertThat(content(refused)).contains("\"errorCode\":\"VALIDATION_ERROR\"");
        assertThat(reload(anne).getName()).isEqualTo("Anne");

        MvcResult updated = updateAccount(anne, "Jürgen", "en");

        assertThat(status(updated)).isEqualTo(200);
        assertThat(body(updated).get("name").asString()).isEqualTo("Jürgen");
        assertThat(reload(anne).getName()).isEqualTo("Jürgen");
        assertThat(reload(anne).getPreferredLanguage()).isEqualTo("en");
    }

    // ---------------------------------------------------------------- change password

    @Test
    void changePassword_issuesAFreshCookie_andEndsEveryOtherSession() throws Exception {
        User anne = anne("change");
        Device laptop = signIn(anne.getEmail(), PASSWORD);
        Device phone = signIn(anne.getEmail(), PASSWORD);
        assertThat(sessionsOf(anne)).isEqualTo(2);

        MvcResult changed = changePassword(laptop, PASSWORD, NEW_PASSWORD);

        assertThat(status(changed)).isEqualTo(204);
        Cookie fresh = refreshCookie(changed);
        assertThat(fresh.getValue()).isNotEqualTo(laptop.cookie().getValue());
        assertThat(changed.getResponse().getHeader("Set-Cookie")).contains("HttpOnly").contains("Secure")
            .contains("SameSite=Strict").contains("Path=/v1/auth");
        assertThat(sessionsOf(anne)).as("only the replacement survives").isEqualTo(1);
        assertThat(status(refresh(laptop.cookie()))).isEqualTo(401);
        assertThat(status(refresh(phone.cookie()))).isEqualTo(401);
        assertThat(status(refresh(fresh))).isEqualTo(200);
        assertThat(status(login(anne.getEmail(), PASSWORD))).isEqualTo(401);
        assertThat(status(login(anne.getEmail(), NEW_PASSWORD))).isEqualTo(200);
    }

    @Test
    void changePassword_withAWrongCurrentPassword_is400_andKeepsEverySession() throws Exception {
        User anne = anne("wrongcurrent");
        Device laptop = signIn(anne.getEmail(), PASSWORD);

        MvcResult result = changePassword(laptop, "Not-the-password-1", NEW_PASSWORD);

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"INVALID_PASSWORD\"");
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        assertThat(status(refresh(laptop.cookie()))).isEqualTo(200);
    }

    /** The root credentials are env-managed; RootUserBootstrap would overwrite a change on the next boot anyway. */
    @Test
    void changePassword_ofTheRootAccount_is403() throws Exception {
        Device root = signIn(ROOT_EMAIL, ROOT_PASSWORD);

        MvcResult result = changePassword(root, ROOT_PASSWORD, NEW_PASSWORD);

        assertThat(status(result)).isEqualTo(403);
        assertThat(content(result)).contains("\"errorCode\":\"ROOT_USER_PROTECTED\"");
    }

    // ---------------------------------------------------------------- deactivate

    @Test
    void deactivate_endsEverySession_andALoginWithinTheGracePeriodReactivates() throws Exception {
        User anne = anne("deactivate");
        Device laptop = signIn(anne.getEmail(), PASSWORD);
        Device phone = signIn(anne.getEmail(), PASSWORD);

        MvcResult result = postJson(laptop, "/v1/account/deactivate",
            Map.of("password", PASSWORD, "reason", "PRIVACY_CONCERNS"));

        assertThat(status(result)).isEqualTo(204);
        assertThat(sessionsOf(anne)).isZero();
        assertThat(status(refresh(laptop.cookie()))).isEqualTo(401);
        assertThat(status(refresh(phone.cookie()))).isEqualTo(401);
        // The access token is still signed and unexpired; the filter's live `active` check is what stops it.
        assertThat(status(mockMvc.perform(get("/v1/account").header(HttpHeaders.AUTHORIZATION, phone.bearer()))
            .andReturn())).isEqualTo(401);

        User gone = reload(anne);
        assertThat(gone.isActive()).isFalse();
        assertThat(gone.getDeactivationReason()).isEqualTo(DeactivationReason.PRIVACY_CONCERNS);
        assertThat(Duration.between(gone.getDeactivatedAt(), gone.getDeletionScheduledAt()))
            .isCloseTo(Duration.ofDays(30), Duration.ofSeconds(2));
        ArgumentCaptor<Instant> deletionDate = ArgumentCaptor.forClass(Instant.class);
        verify(authMailer).sendAccountDeactivated(eq(new MailRecipient(anne.getEmail(), "Anne", "de")),
            deletionDate.capture());
        assertThat(deletionDate.getValue()).isCloseTo(gone.getDeletionScheduledAt(), within(2, ChronoUnit.SECONDS));

        MvcResult back = login(anne.getEmail(), PASSWORD);
        assertThat(status(back)).isEqualTo(200);
        assertThat(body(back).get("reactivated").asBoolean()).isTrue();
    }

    @Test
    void deactivate_withAnAdminReason_is400_andKeepsTheAccount() throws Exception {
        User anne = anne("adminreason");
        Device laptop = signIn(anne.getEmail(), PASSWORD);

        MvcResult result = postJson(laptop, "/v1/account/deactivate", Map.of("password", PASSWORD, "reason", "SPAM"));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"VALIDATION_ERROR\"");
        assertThat(reload(anne).isActive()).isTrue();
        assertThat(status(refresh(laptop.cookie()))).isEqualTo(200);
    }

    @Test
    void deactivate_withAWrongPassword_is400() throws Exception {
        User anne = anne("wrongpw");
        Device laptop = signIn(anne.getEmail(), PASSWORD);

        MvcResult result = postJson(laptop, "/v1/account/deactivate",
            Map.of("password", "Not-the-password-1", "reason", "OTHER"));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"INVALID_PASSWORD\"");
        assertThat(reload(anne).isActive()).isTrue();
    }

    // ---------------------------------------------------------------- avatar

    private static byte[] png(int width, int height) throws IOException {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.ORANGE);
        g.fillRect(0, 0, width, height);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private MvcResult upload(User user, byte[] bytes) throws Exception {
        return mockMvc.perform(multipart("/v1/account/avatar")
            .file(new MockMultipartFile("image", "me.png", "image/png", bytes))
            .header(HttpHeaders.AUTHORIZATION, bearer(user))).andReturn();
    }

    private static Path fileOf(String avatarUrl) {
        return Path.of(UPLOAD_DIRECTORY).resolve(avatarUrl.substring("/uploads/".length()));
    }

    @Test
    void avatar_isStored_served_replaced_andRemoved() throws Exception {
        User anne = anne("avatar");

        MvcResult first = upload(anne, png(640, 480));
        assertThat(status(first)).isEqualTo(200);
        String firstUrl = body(first).get("avatarUrl").asString();
        assertThat(firstUrl).matches("/uploads/avatars/user_" + anne.getId() + "_\\d+_\\d+\\.webp");
        assertThat(fileOf(firstUrl)).exists();
        // Public, like the contract says: an <img> tag sends no bearer.
        MvcResult served = mockMvc.perform(get(firstUrl)).andReturn();
        assertThat(status(served)).isEqualTo(200);
        assertThat(served.getResponse().getContentAsByteArray()).isNotEmpty();

        String secondUrl = body(upload(anne, png(300, 300))).get("avatarUrl").asString();
        assertThat(secondUrl).isNotEqualTo(firstUrl);
        assertThat(fileOf(secondUrl)).exists();
        assertThat(fileOf(firstUrl)).as("the replaced file is deleted once the switch committed").doesNotExist();
        assertThat(reload(anne).getAvatarUrl()).isEqualTo(secondUrl);

        MvcResult removed = mockMvc.perform(delete("/v1/account/avatar")
            .header(HttpHeaders.AUTHORIZATION, bearer(anne))).andReturn();
        assertThat(status(removed)).isEqualTo(200);
        assertThat(body(removed).get("avatarUrl").isNull()).isTrue();
        assertThat(fileOf(secondUrl)).doesNotExist();
        assertThat(reload(anne).getAvatarUrl()).isNull();
    }

    @Test
    void avatar_whoseBytesAreNoImage_is400_andStoresNothing() throws Exception {
        User anne = anne("notanimage");

        MvcResult result = upload(anne, "definitely not a png".getBytes());

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"INVALID_FILE_TYPE\"");
        assertThat(reload(anne).getAvatarUrl()).isNull();
    }

    /** Hard-delete removes the avatar file too; sessions go with the row through the foreign key. */
    @Test
    void deletingTheAccount_removesItsAvatarFileAndSessions() throws Exception {
        User anne = anne("deleted");
        signIn(anne.getEmail(), PASSWORD);
        String avatarUrl = body(upload(anne, png(100, 100))).get("avatarUrl").asString();

        MvcResult deleted = mockMvc.perform(delete("/v1/users/" + anne.getId())
            .header(HttpHeaders.AUTHORIZATION, bearer(root()))).andReturn();

        assertThat(status(deleted)).isEqualTo(204);
        assertThat(userRepository.findById(anne.getId())).isEmpty();
        assertThat(sessionsOf(anne)).isZero();
        assertThat(fileOf(avatarUrl)).doesNotExist();
    }
}
