package app.billetstudio.auth.security;

import java.io.IOException;
import java.util.List;
import java.util.Set;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.util.ClientIp;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import lombok.extern.slf4j.Slf4j;

import org.jspecify.annotations.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Authenticates a request by its Bearer access token; the principal is the {@link User} entity. */
@Slf4j
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    /**
     * The session handshake, authorised by the refresh cookie or by credentials - never by the Authorization
     * header. /refresh exists precisely for the moment the access token is dead; reading the header there
     * anyway 401ed the very call that would have replaced the token, so no session could be renewed and no
     * logout reached the server. Mirrored by the frontend's authTokenInterceptor, which does not attach the
     * token to these three to begin with.
     */
    private static final Set<String> COOKIE_AUTHORISED_URIS = Set.of("/v1/auth/login", "/v1/auth/refresh",
        "/v1/auth/logout");

    private final JwtUtil jwtUtil;
    private final UserRepository userRepository;
    private final JsonAuthenticationEntryPoint unauthorized;

    public JwtAuthenticationFilter(JwtUtil jwtUtil, UserRepository userRepository,
        JsonAuthenticationEntryPoint unauthorized) {
        this.jwtUtil = jwtUtil;
        this.userRepository = userRepository;
        this.unauthorized = unauthorized;
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        return COOKIE_AUTHORISED_URIS.contains(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
        @NonNull FilterChain filterChain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");

        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);

            try {
                Long userId = jwtUtil.validateTokenAndGetUserId(token);

                User user = userRepository.findById(userId)
                    .orElseThrow(() -> {
                        log.warn("JWT valid but user not found: userId={}, ip={}, uri={}",
                            userId, getClientIP(request), request.getRequestURI());
                        return new JwtAuthException();
                    });

                if (!user.isActive()) {
                    log.warn("JWT valid but user is deactivated: userId={}, ip={}, uri={}",
                        userId, getClientIP(request), request.getRequestURI());
                    throw new JwtAuthException();
                }

                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    user, null, List.of(new SimpleGrantedAuthority(user.getRole().getName())));
                SecurityContextHolder.getContext().setAuthentication(auth);

            } catch (JwtAuthException e) {
                log.warn("Authentication failed: ip={}, uri={}", getClientIP(request), request.getRequestURI());
                SecurityContextHolder.clearContext();
                // Runs before ExceptionTranslationFilter, so this rejection is written here rather than
                // raised - through the same entry point, so there is one 401 body.
                unauthorized.writeUnauthorized(response);
                return;
            }
        }

        filterChain.doFilter(request, response);
    }

    private static String getClientIP(HttpServletRequest request) {
        // Rightmost hop = real client per the trusted proxy; leftmost is spoofable and would let an attacker
        // forge the ip=... in these auth audit logs. See ClientIp for the trust model.
        return ClientIp.resolve(request.getHeader("X-Forwarded-For"), request.getRemoteAddr());
    }
}
