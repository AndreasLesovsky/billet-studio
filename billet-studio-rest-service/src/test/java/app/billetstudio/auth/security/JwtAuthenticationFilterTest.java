package app.billetstudio.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.stream.Stream;

import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;

import jakarta.servlet.FilterChain;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import tools.jackson.databind.json.JsonMapper;

/**
 * Each rejection asserts the 401 body AND that the chain never ran: a filter that answers 401 but still calls the
 * chain would hand a controller a cleared context. Anonymous pass-through, the handshake skip and deactivated users are
 * pinned end to end by SecurityRoutesIT / AuthControllerIT.
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

    private JwtAuthenticationFilter filter() {
        return new JwtAuthenticationFilter(jwtUtil, userRepository,
            new JsonAuthenticationEntryPoint(JsonMapper.builder().build()));
    }

    private static User user(long id, String role) {
        User user = new User();
        user.setId(id);
        user.setEmail("someone@example.com");
        user.setActive(true);
        user.setRole(new Role(role.equals("ROLE_ADMIN") ? 2L : 1L, role, null));
        return user;
    }

    private static MockHttpServletRequest requestWith(String authorizationHeader) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v1/account");
        request.addHeader("Authorization", authorizationHeader);
        return request;
    }

    private static void assertUnauthorized(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("\"errorCode\":\"UNAUTHORIZED\"");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    static Stream<Arguments> rejectedTokens() {
        return Stream.of(
            Arguments.of("expired", "Bearer " + new JwtUtil(SECRET, -60_000L, false).generateToken(7L)),
            Arguments.of("signed with another secret",
                "Bearer " + new JwtUtil(OTHER_SECRET, ONE_HOUR, false).generateToken(7L)),
            Arguments.of("malformed", "Bearer not-a-jwt"),
            Arguments.of("empty", "Bearer "));
    }

    @ParameterizedTest(name = "{0} token is rejected before any user lookup")
    @MethodSource("rejectedTokens")
    void rejected_token_never_reaches_the_chain(String label, String header) throws Exception {
        MockHttpServletRequest request = requestWith(header);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
        verifyNoInteractions(userRepository);
    }

    @Test
    void valid_token_of_a_deleted_user_is_rejected() throws Exception {
        when(userRepository.findById(anyLong())).thenReturn(Optional.empty());

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        assertUnauthorized(response);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void authority_is_the_live_role_not_one_from_the_token() throws Exception {
        // The JWT carries only the subject, so a demotion takes effect on the very next request.
        User user = user(7L, "ROLE_USER");
        when(userRepository.findById(7L)).thenReturn(Optional.of(user));

        MockHttpServletRequest request = requestWith("Bearer " + jwtUtil.generateToken(7L));
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);

        filter().doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getPrincipal()).isSameAs(user);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
            .extracting(Object::toString)
            .containsExactly("ROLE_USER");
    }
}
