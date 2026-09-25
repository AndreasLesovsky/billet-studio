package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;

import app.billetstudio.auth.dto.AccountDto;
import app.billetstudio.auth.dto.AccountUpdateDto;
import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.exception.InvalidPasswordException;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AccountService;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.auth.service.UserService;
import app.billetstudio.support.StandaloneMvc;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * /v1/account with the services mocked: which service call each endpoint makes, in which order, and what the
 * caller gets back. That change-password and deactivate really end the sessions is UserServiceTest (the calls) and
 * AccountControllerIT (the rows).
 */
class AccountControllerTest {

    private static final Instant CREATED = Instant.parse("2026-01-01T00:00:00Z");

    private final AccountService accountService = mock(AccountService.class);
    private final UserService userService = mock(UserService.class);
    private final AuthSessionService authSessionService = mock(AuthSessionService.class);

    private final MockMvc mockMvc = StandaloneMvc.of(new AccountController(accountService, userService,
        authSessionService, new RefreshCookie(true, "Strict")));

    private final User anne = anne();

    private static User anne() {
        User user = new User();
        user.setId(7L);
        user.setName("Anne");
        user.setEmail("anne@example.com");
        user.setPreferredLanguage("de");
        user.setRole(new Role(1L, Roles.USER, null));
        user.setActive(true);
        user.setCreatedAt(CREATED);
        return user;
    }

    private AccountDto dto(String avatarUrl) {
        return new AccountDto(7L, "Anne", "anne@example.com", Roles.USER, "de", avatarUrl, CREATED);
    }

    @BeforeEach
    void signIn() {
        StandaloneMvc.signIn(anne);
    }

    @AfterEach
    void signOut() {
        StandaloneMvc.signOut();
    }

    private MvcResult changePassword(String json) throws Exception {
        return mockMvc.perform(post("/v1/account/change-password").contentType(MediaType.APPLICATION_JSON)
            .content(json)).andReturn();
    }

    @Test
    void getAccount_answersWithTheContractShape() throws Exception {
        when(accountService.getAccount(anne)).thenReturn(dto(null));

        mockMvc.perform(get("/v1/account"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(7))
            .andExpect(jsonPath("$.role").value(Roles.USER))
            .andExpect(jsonPath("$.avatarUrl").isEmpty())
            .andExpect(jsonPath("$.createdAt").value("2026-01-01T00:00:00Z"))
            .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    @Test
    void updateAccount_updatesTheSignedInUser() throws Exception {
        when(accountService.updateAccount(7L, new AccountUpdateDto("Anna", "en"))).thenReturn(dto(null));

        mockMvc.perform(put("/v1/account").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Anna\",\"preferredLanguage\":\"en\"}"))
            .andExpect(status().isOk());

        verify(accountService).updateAccount(7L, new AccountUpdateDto("Anna", "en"));
    }

    /** The contract has no optional fields here (CommerceX treated a missing one as "unchanged"). */
    @Test
    void updateAccount_withoutALanguage_is400() throws Exception {
        mockMvc.perform(put("/v1/account").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Anna\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verifyNoInteractions(accountService);
    }

    // ---------------------------------------------------------------- change password

    /**
     * The service ends EVERY session, this one included; only afterwards may the controller start the caller's
     * replacement - the other way round, the fresh session would be ended with the rest.
     */
    @Test
    void changePassword_endsTheSessionsFirst_thenIssuesTheCallerAFreshCookie() throws Exception {
        AuthSession session = new AuthSession();
        when(authSessionService.startSession(anne))
            .thenReturn(new AuthSessionService.IssuedSession("fresh-token", session));
        when(authSessionService.remainingFor(session)).thenReturn(Duration.ofDays(14));

        MvcResult result = changePassword(
            "{\"currentPassword\":\"Old1pass\",\"newPassword\":\"New1pass\",\"confirmPassword\":\"New1pass\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(204);
        InOrder order = inOrder(userService, authSessionService);
        order.verify(userService).changePassword(7L, "Old1pass", "New1pass", "New1pass");
        order.verify(authSessionService).startSession(anne);
        assertThat(result.getResponse().getHeader("Set-Cookie")).startsWith("refresh_token=fresh-token")
            .contains("Path=/v1/auth").contains("HttpOnly").contains("Secure").contains("SameSite=Strict");
    }

    @Test
    void changePassword_withAWrongCurrentPassword_is400_andIssuesNothing() throws Exception {
        doThrow(new InvalidPasswordException()).when(userService)
            .changePassword(anyLong(), anyString(), anyString(), anyString());

        MvcResult result = changePassword(
            "{\"currentPassword\":\"wrong\",\"newPassword\":\"New1pass\",\"confirmPassword\":\"New1pass\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(result.getResponse().getContentAsString()).contains("\"errorCode\":\"INVALID_PASSWORD\"");
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        verify(authSessionService, never()).startSession(any());
    }

    @Test
    void changePassword_withABlankField_is400() throws Exception {
        MvcResult result = changePassword("{\"currentPassword\":\"Old1pass\",\"newPassword\":\"\"}");

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        verifyNoInteractions(userService, authSessionService);
    }

    @Test
    void changePassword_sixthAttemptWithinAQuarterHour_is429() throws Exception {
        doThrow(new InvalidPasswordException()).when(userService)
            .changePassword(anyLong(), anyString(), anyString(), anyString());
        String guess = "{\"currentPassword\":\"guess\",\"newPassword\":\"New1pass\",\"confirmPassword\":\"New1pass\"}";

        for (int i = 0; i < 5; i++) {
            assertThat(changePassword(guess).getResponse().getStatus()).isEqualTo(400);
        }

        assertThat(changePassword(guess).getResponse().getStatus()).isEqualTo(429);
    }

    // ---------------------------------------------------------------- deactivate

    /** The service ends every session; unlike change-password nobody gets a replacement. */
    @Test
    void deactivate_is204_passesPasswordAndReason_andIssuesNoNewSession() throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/account/deactivate").contentType(MediaType.APPLICATION_JSON)
            .content("{\"password\":\"Secret123\",\"reason\":\"PRIVACY_CONCERNS\"}")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(204);
        verify(userService).deactivateAccount(7L, "Secret123", DeactivationReason.PRIVACY_CONCERNS);
        verifyNoInteractions(authSessionService);
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
    }

    @Test
    void deactivate_withoutAReason_isAllowed() throws Exception {
        mockMvc.perform(post("/v1/account/deactivate").contentType(MediaType.APPLICATION_JSON)
            .content("{\"password\":\"Secret123\",\"reason\":null}"))
            .andExpect(status().isNoContent());

        verify(userService).deactivateAccount(7L, "Secret123", null);
    }

    @Test
    void deactivate_withAReasonOutsideTheEnum_is400() throws Exception {
        mockMvc.perform(post("/v1/account/deactivate").contentType(MediaType.APPLICATION_JSON)
            .content("{\"password\":\"Secret123\",\"reason\":\"BORED\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("MALFORMED_REQUEST"));

        verifyNoInteractions(userService);
    }

    @Test
    void deactivate_withoutAPassword_is400() throws Exception {
        mockMvc.perform(post("/v1/account/deactivate").contentType(MediaType.APPLICATION_JSON)
            .content("{\"reason\":\"OTHER\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verifyNoInteractions(userService);
    }

    // ---------------------------------------------------------------- avatar

    @Test
    void uploadAvatar_passesThePartToTheService() throws Exception {
        MockMultipartFile image = new MockMultipartFile("image", "me.png", "image/png", new byte[]{1, 2, 3});
        when(accountService.updateAvatar(any(), any())).thenReturn(dto("/uploads/avatars/user_7_1_1.webp"));

        mockMvc.perform(multipart("/v1/account/avatar").file(image))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.avatarUrl").value("/uploads/avatars/user_7_1_1.webp"));

        verify(accountService).updateAvatar(7L, image);
    }

    @Test
    void uploadAvatar_underAnotherPartName_is400() throws Exception {
        mockMvc.perform(multipart("/v1/account/avatar")
            .file(new MockMultipartFile("file", "me.png", "image/png", new byte[]{1})))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verifyNoInteractions(accountService);
    }

    @Test
    void removeAvatar_answersWithTheUpdatedAccount() throws Exception {
        when(accountService.removeAvatar(7L)).thenReturn(dto(null));

        mockMvc.perform(delete("/v1/account/avatar"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.avatarUrl").isEmpty());
    }
}
