package app.billetstudio.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;

import jakarta.servlet.FilterChain;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import tools.jackson.databind.json.JsonMapper;

/**
 * The filter that authenticates every single request.
 *
 * Two things are asserted for each rejection, not one: the 401 body AND that the chain never ran. A filter that
 * answers 401 but still calls the chain would let the request through to a controller with a cleared context - the
 * failure would look like an authorization bug somewhere else entirely.
 */
@ExtendWith(MockitoExtension.class)
class JwtAuthenticationFilterTest {

    // 64 ASCII chars = 64 bytes, the HS512 minimum.
    private static final String SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String OTHER_SECRET = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    private static final long ONE_HOUR = 3_600_000L;

    private final JwtUtil jwtUtil = new JwtUtil(SECRET, ONE_HOUR, false);

    @Mock
    private UserRepository userRepository;

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    // Jackson 3 (tools.jackson): java.time support is built into databind, so a plain builder serialises
    // ApiError's Instant.
    private final JsonAuthenticationEntryPoint unauthorized = new JsonAuthenticationEntryPoint(
        JsonMapper.builder().build());

    private JwtAuthenticationFilter filter() {
        return new JwtAuthenticationFilter(jwtUtil, userRepository, unauthorized);
    }

    private static User user(long id, String role, boolean active) {
        User user = new User();
        user.setId(id);
        user.setEmail("someone@example.com");
        user.setActive(active);
        user.setRole(new Role(role.equals("ROLE_ADMIN") ? 2L : 1L, role, null));
        return user;
    }

    private static MockHttpServletRequest requestWith(String authorizationHeader) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v1/account");
        if (authorizationHeader != null) {
            request.addHeader("Authorization", authorizationHeader);
        }
        return request;
    }

    private static void assertUnauthorized(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentType()).startsWith("application/json");
        assertThat(response.getContentAsString()).contains("\"errorCode\":\"UNAUTHORIZED\"");
        // Same ApiError shape the GlobalExceptionHandler returns - one 401 body, not two.
        assertThat(response.getContentAsString()).contains("\"status\":401").contains("\"timestamp\"");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void validTokenOfAnActiveUser_authenticatesAndContinues() throws Exception {
        User user = user(7L, "ROLE_ADMIN", true);
        when(userRepository.findById(7L)).thenReturn(Optional.of(user));

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(response.getStatus()).isEqualTo(200);

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(auth.getPrincipal()).isSameAs(user);
        assertThat(auth.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_ADMIN");
    }

    @Test
    void noAuthorizationHeader_passesThroughUnauthenticated() throws Exception {
        MockHttpServletRequest request = requestWith(null);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        // Anonymous requests are normal (the public billet page, login, the model catalog); the filter must not
        // reject them. Whether the endpoint needs a login is SecurityConfig's decision, see SecurityRoutesIT.
        verify(chain).doFilter(request, response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(userRepository);
    }

    @Test
    void nonBearerAuthorizationHeader_passesThroughUnauthenticated() throws Exception {
        MockHttpServletRequest request = requestWith("Basic dXNlcjpwYXNz");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(userRepository);
    }

    @Test
    void expiredToken_isRejected() throws Exception {
        // Minted with a negative lifetime, so its exp lies a minute in the past.
        JwtUtil alreadyExpired = new JwtUtil(SECRET, -60_000L, false);

        MockHttpServletRequest request = requestWith("Bearer " + alreadyExpired.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
        verifyNoInteractions(userRepository);
    }

    @Test
    void expiredToken_doesNotTouchTheSessionHandshake() throws Exception {
        // /refresh exists precisely for the moment the access token is dead; filtering the handshake would 401 every
        // renewal after minute fifteen. It is authorised by the refresh cookie, never by this header.
        JwtUtil alreadyExpired = new JwtUtil(SECRET, -60_000L, false);

        for (String uri : List.of("/v1/auth/login", "/v1/auth/refresh", "/v1/auth/logout")) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
            request.addHeader("Authorization", "Bearer " + alreadyExpired.generateToken(7L));
            MockHttpServletResponse response = new MockHttpServletResponse();
            FilterChain chain = mock(FilterChain.class);

            filter().doFilter(request, response, chain);

            verify(chain).doFilter(request, response);
            assertThat(response.getStatus()).as(uri).isEqualTo(200);
        }
        verifyNoInteractions(userRepository);
    }

    @Test
    void tokenSignedWithAnotherSecret_isRejected() throws Exception {
        JwtUtil foreign = new JwtUtil(OTHER_SECRET, ONE_HOUR, false);

        MockHttpServletRequest request = requestWith("Bearer " + foreign.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
        verifyNoInteractions(userRepository);
    }

    @Test
    void malformedToken_isRejected() throws Exception {
        MockHttpServletRequest request = requestWith("Bearer not-a-jwt");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
        verifyNoInteractions(userRepository);
    }

    @Test
    void emptyBearerToken_isRejected() throws Exception {
        MockHttpServletRequest request = requestWith("Bearer ");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
        verifyNoInteractions(userRepository);
    }

    @Test
    void validTokenOfADeletedUser_isRejected() throws Exception {
        when(userRepository.findById(anyLong())).thenReturn(Optional.empty());

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void validTokenOfADeactivatedUser_isRejected() throws Exception {
        // The reason the filter reads the user on every request at all: a token minted before the lock is still
        // cryptographically valid, so only the live `active` flag can stop it.
        when(userRepository.findById(7L)).thenReturn(Optional.of(user(7L, "ROLE_USER", false)));

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void theAuthorityIsTheLiveRole_notOneFromTheToken() throws Exception {
        // The JWT carries only the subject. A demotion takes effect on the very next request.
        when(userRepository.findById(7L)).thenReturn(Optional.of(user(7L, "ROLE_USER", true)));

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        filter().doFilter(request, new MockHttpServletResponse(), mock(FilterChain.class));

        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
            .extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }
}
