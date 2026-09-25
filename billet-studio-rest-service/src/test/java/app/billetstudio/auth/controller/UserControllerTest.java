package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import app.billetstudio.auth.entity.AuthSession;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.auth.service.UserService;
import app.billetstudio.shared.storage.FileStorageService;
import app.billetstudio.support.StandaloneMvc;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The admin user list over HTTP, with the REAL UserService behind the controller and only the repositories mocked:
 * the query parameters as a browser sends them, and what reaches the query. The SQL itself (escaping, the role sort
 * on MariaDB) is UserControllerIT; that only admins get here at all is SecurityRoutesIT.
 */
class UserControllerTest {

    private static final Role USER_ROLE = new Role(1L, Roles.USER, null);
    private static final Role ADMIN_ROLE = new Role(2L, Roles.ADMIN, null);

    private final UserRepository userRepository = mock(UserRepository.class);
    private final RoleRepository roleRepository = mock(RoleRepository.class);
    private final AuthSessionService authSessionService = mock(AuthSessionService.class);
    private final BCryptPasswordEncoder passwordEncoder = mock(BCryptPasswordEncoder.class);

    private final UserService userService = new UserService(userRepository, roleRepository, authSessionService,
        passwordEncoder, mock(AuthMailer.class), mock(FileStorageService.class), mock(ApplicationEventPublisher.class));
    private final MockMvc mockMvc = StandaloneMvc.of(new UserController(userService, roleRepository,
        authSessionService, new RefreshCookie(true, "Strict")));

    private final User admin = user(1L, "Ada", ADMIN_ROLE);

    private static User user(long id, String name, Role role) {
        User user = new User();
        user.setId(id);
        user.setName(name);
        user.setEmail(name.toLowerCase() + "@example.com");
        user.setPreferredLanguage("de");
        user.setPasswordHash("hash");
        user.setRole(role);
        user.setActive(true);
        user.setCreatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        user.setUpdatedAt(Instant.parse("2026-01-02T00:00:00Z"));
        return user;
    }

    @BeforeEach
    void signIn() {
        ReflectionTestUtils.setField(userService, "frontendUrl", "https://billet.example.com");
        StandaloneMvc.signIn(admin);
        when(userRepository.searchAdmin(any(), any(), any()))
            .thenAnswer(inv -> new PageImpl<>(List.of(user(5L, "Anne", USER_ROLE)), inv.getArgument(2), 1));
    }

    @AfterEach
    void signOut() {
        StandaloneMvc.signOut();
    }

    private Pageable pageable() {
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(userRepository).searchAdmin(any(), any(), pageable.capture());
        return pageable.getValue();
    }

    // ---------------------------------------------------------------- the list

    @Test
    void list_withoutParameters_isTheFirstPageOf20_newestFirst() throws Exception {
        mockMvc.perform(get("/v1/users"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.rows[0].id").value(5))
            .andExpect(jsonPath("$.rows[0].role").value(Roles.USER))
            .andExpect(jsonPath("$.totalRows").value(1))
            .andExpect(jsonPath("$.page").value(0))
            .andExpect(jsonPath("$.size").value(20))
            .andExpect(jsonPath("$.rows[0].passwordHash").doesNotExist());

        assertThat(pageable().getPageNumber()).isZero();
        assertThat(pageable().getPageSize()).isEqualTo(20);
        assertThat(pageable().getSort()).isEqualTo(Sort.by(Sort.Direction.DESC, "createdAt", "id"));
        verify(userRepository).searchAdmin(isNull(), isNull(), any());
    }

    @Test
    void list_passesTheTextFilterEscaped_andTheActiveFlag() throws Exception {
        mockMvc.perform(get("/v1/users").param("q", " Ann_ ").param("active", "false"))
            .andExpect(status().isOk());

        verify(userRepository).searchAdmin(eq("%ann!_%"), eq(false), any());
    }

    /** "active=" is how the frontend sends "both"; it must not turn into false. */
    @Test
    void list_emptyActive_meansBothStates() throws Exception {
        mockMvc.perform(get("/v1/users").param("active", "")).andExpect(status().isOk());

        verify(userRepository).searchAdmin(isNull(), isNull(), any());
    }

    @Test
    void list_sortsByTheRoleName_withTheIdAsTieBreaker() throws Exception {
        mockMvc.perform(get("/v1/users").param("sort", "role,desc").param("page", "2").param("size", "50"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.page").value(2))
            .andExpect(jsonPath("$.size").value(50));

        assertThat(pageable().getSort()).isEqualTo(Sort.by(Sort.Direction.DESC, "role.name", "id"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"size=101", "size=0", "page=-1", "sort=passwordHash", "sort=name,up", "page=first",
        "active=maybe"})
    void list_parametersOutsideTheWhitelist_are400ValidationErrors(String parameter) throws Exception {
        String[] pair = parameter.split("=", 2);

        mockMvc.perform(get("/v1/users").param(pair[0], pair[1]))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verify(userRepository, never()).searchAdmin(any(), any(), any());
    }

    @Test
    void list_searchTextOver100Characters_is400() throws Exception {
        mockMvc.perform(get("/v1/users").param("q", "x".repeat(101)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));

        verify(userRepository, never()).searchAdmin(any(), any(), any());
    }

    @Test
    void list_acceptsExactlyTheMaximumPageSize() throws Exception {
        mockMvc.perform(get("/v1/users").param("size", String.valueOf(UserService.MAX_PAGE_SIZE)))
            .andExpect(status().isOk());

        assertThat(pageable().getPageSize()).isEqualTo(100);
    }

    // ---------------------------------------------------------------- the rest of the admin API

    @Test
    void roles_areListedInIdOrder() throws Exception {
        when(roleRepository.findAll(Sort.by("id"))).thenReturn(List.of(USER_ROLE, ADMIN_ROLE));

        mockMvc.perform(get("/v1/users/roles"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0]").value(Roles.USER))
            .andExpect(jsonPath("$[1]").value(Roles.ADMIN));
    }

    @Test
    void getUser_unknownId_is404UserNotFound() throws Exception {
        when(userRepository.findById(99L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/v1/users/99"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.errorCode").value("USER_NOT_FOUND"));
    }

    @Test
    void updateUser_unknownId_is404_notAnEmptyOk() throws Exception {
        when(userRepository.findById(99L)).thenReturn(Optional.empty());

        mockMvc.perform(put("/v1/users/99").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Anne\",\"email\":\"anne@example.com\",\"password\":\"\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.errorCode").value("USER_NOT_FOUND"));
    }

    /** Changing your own password ends your own session too; the answer carries its replacement. */
    @Test
    void updateUser_ownPassword_answersWithAReplacementCookie() throws Exception {
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin));
        when(userRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        AuthSession session = new AuthSession();
        when(authSessionService.startSession(admin))
            .thenReturn(new AuthSessionService.IssuedSession("replacement", session));
        when(authSessionService.remainingFor(session)).thenReturn(Duration.ofMinutes(30));

        MvcResult result = mockMvc.perform(put("/v1/users/1").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Ada\",\"email\":\"ada@example.com\",\"password\":\"Newpass123\"}"))
            .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        verify(authSessionService).endAllSessions(1L);
        assertThat(result.getResponse().getHeader("Set-Cookie")).startsWith("refresh_token=replacement");
    }

    @Test
    void updateUser_someoneElsesPassword_leavesTheCallersSessionAlone() throws Exception {
        when(userRepository.findById(5L)).thenReturn(Optional.of(user(5L, "Anne", USER_ROLE)));
        when(userRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        MvcResult result = mockMvc.perform(put("/v1/users/5").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"Anne\",\"email\":\"anne@example.com\",\"password\":\"Newpass123\"}"))
            .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
        verify(authSessionService, never()).startSession(any());
    }

    @Test
    void deleteUser_self_is403CannotDeleteSelf() throws Exception {
        mockMvc.perform(delete("/v1/users/1"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("CANNOT_DELETE_SELF"));
    }

    @Test
    void deleteUser_protectedRoot_is403RootUserProtected() throws Exception {
        User root = user(3L, "Root", ADMIN_ROLE);
        root.setProtectedAccount(true);
        when(userRepository.findById(3L)).thenReturn(Optional.of(root));

        mockMvc.perform(delete("/v1/users/3"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.errorCode").value("ROOT_USER_PROTECTED"));
    }

    @Test
    void toggleActive_withoutABody_locksWithoutAReason() throws Exception {
        User anne = user(5L, "Anne", USER_ROLE);
        when(userRepository.findById(5L)).thenReturn(Optional.of(anne));
        when(userRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(patch("/v1/users/5/active"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.active").value(false))
            .andExpect(jsonPath("$.deactivationReason").isEmpty());
    }

    @Test
    void toggleActive_withAUsersReason_is400() throws Exception {
        mockMvc.perform(patch("/v1/users/5/active").contentType(MediaType.APPLICATION_JSON)
            .content("{\"reason\":\"TOO_COMPLICATED\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"));
    }
}
