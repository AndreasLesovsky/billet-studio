package app.billetstudio.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.security.JwtUtil;
import app.billetstudio.auth.security.RefreshCookie;

import jakarta.servlet.http.Cookie;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The whole application over MockMvc (security filter chain included) against the shared MariaDB. Every subclass
 * with the same configuration shares one cached context, which is why the mail seam is mocked HERE and not per
 * class: a bean override in a subclass would start a second context. The mock doubles as the inbox the reset flow
 * reads its link from, and nothing is ever sent.
 *
 * Nothing is rolled back between tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
public abstract class WebITBase extends MariaDbITBase {

    @Autowired
    protected MockMvc mockMvc;
    @Autowired
    protected UserRepository userRepository;
    @Autowired
    protected RoleRepository roleRepository;
    @Autowired
    protected BCryptPasswordEncoder passwordEncoder;
    @Autowired
    protected JwtUtil jwtUtil;
    @Autowired
    protected JsonMapper jsonMapper;

    @MockitoBean
    protected AuthMailer authMailer;

    protected User createUser(String name, String email, String password, String roleName) {
        User user = new User();
        user.setName(name);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setRole(roleRepository.findByName(roleName).orElseThrow());
        user.setPreferredLanguage("de");
        user.setActive(true);
        return userRepository.save(user);
    }

    protected User reload(User user) {
        return userRepository.findById(user.getId()).orElseThrow();
    }

    /** The protected root account RootUserBootstrap reconciled from the pinned app.root.* at context start. */
    protected User root() {
        return userRepository.findByEmail(ROOT_EMAIL).orElseThrow();
    }

    /** A valid access token minted directly, for tests about what a token may reach rather than how it is got. */
    protected String bearer(User user) {
        return "Bearer " + jwtUtil.generateToken(user.getId());
    }

    protected MvcResult login(String email, String password) throws Exception {
        return mockMvc.perform(post("/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("email", email, "password", password))))
            .andReturn();
    }

    protected MvcResult refresh(Cookie cookie) throws Exception {
        return mockMvc.perform(post("/v1/auth/refresh").cookie(cookie)).andReturn();
    }

    protected String json(Object value) {
        return jsonMapper.writeValueAsString(value);
    }

    protected JsonNode body(MvcResult result) throws Exception {
        return jsonMapper.readTree(content(result));
    }

    protected static String content(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    protected static int status(MvcResult result) {
        return result.getResponse().getStatus();
    }

    protected static Cookie refreshCookie(MvcResult result) {
        Cookie cookie = result.getResponse().getCookie(RefreshCookie.NAME);
        assertThat(cookie).as("refresh cookie").isNotNull();
        return cookie;
    }
}
