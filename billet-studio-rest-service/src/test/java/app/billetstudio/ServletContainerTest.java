package app.billetstudio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.stream.Stream;

import app.billetstudio.auth.bootstrap.RootUserBootstrap;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.repository.AuthSessionRepository;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.security.JwtUtil;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.shared.web.RequestBodyLimitAdvice;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.filter.FormContentFilter;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The application on a real servlet container, what MockMvc cannot show: a sendError is forwarded to /error in a
 * second dispatch that carries no authentication. There is no database; the repositories are mocks, the datasource
 * points nowhere and Hibernate never asks it for metadata, so this runs without Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:mysql://127.0.0.1:1/unreachable",
    "spring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false",
    "spring.jpa.show-sql=false",
    "spring.mail.host=127.0.0.1",
    "spring.mail.port=1",
    // The database is unreachable on purpose; its indicator would report exactly that.
    "management.health.db.enabled=false",
    "app.mail.enabled=false",
    "app.rate-limit.enabled=false",
    "app.security.enforce-strong-secrets=false",
    "app.jwt.secret=servlet-container-test-only-0123456789abcdef0123456789abcdef0123456789",
    "app.root.email=root@container.test",
    "app.root.password=Root-password-of-the-container-test-1",
    "app.upload.directory=target/container-test-uploads",
    "app.log.directory=target/container-test-logs",
    "app.billet.max-document-bytes=" + ServletContainerTest.MAX_DOCUMENT_BYTES
})
class ServletContainerTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    /** Small, so a body past the billet cap stays under Tomcat's 2 MiB swallow limit and the answer arrives. */
    static final int MAX_DOCUMENT_BYTES = 65536;

    @LocalServerPort
    private int port;

    @Autowired
    private JwtUtil jwtUtil;
    @Autowired
    private JsonMapper jsonMapper;
    @Autowired
    private ApplicationContext context;

    @MockitoBean
    private UserRepository userRepository;
    @MockitoBean
    private RoleRepository roleRepository;
    @MockitoBean
    private AuthSessionRepository authSessionRepository;
    @MockitoBean
    private RootUserBootstrap rootUserBootstrap;
    @MockitoBean
    private AuthMailer authMailer;

    private final User user = new User();

    @BeforeEach
    void aSignedInUser() {
        user.setId(5L);
        user.setName("Anne");
        user.setEmail("anne@container.test");
        user.setRole(new Role(1L, Roles.USER, null));
        user.setActive(true);
        when(userRepository.findById(5L)).thenReturn(Optional.of(user));
    }

    private HttpResponse<String> get(String path, String bearer) throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
        if (bearer != null) {
            request.header("Authorization", "Bearer " + bearer);
        }
        return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    /**
     * The default access-denied handler's sendError(403) reached /error without the JWT authentication and came
     * back as 401 - which the frontend answers by refreshing, retrying and finally logging the user out.
     */
    @Test
    void a_user_on_an_admin_route_gets_the_403_access_denied_error() throws Exception {
        HttpResponse<String> response = get("/v1/users", jwtUtil.generateToken(user.getId()));

        assertThat(response.statusCode()).isEqualTo(403);
        JsonNode body = jsonMapper.readTree(response.body());
        assertThat(body.get("errorCode").asString()).isEqualTo("ACCESS_DENIED");
        assertThat(body.get("status").asInt()).isEqualTo(403);
    }

    /** StrictHttpFirewall answers with sendError(400); the forward to /error must keep that status. */
    @Test
    void a_request_the_firewall_rejects_keeps_its_400() throws Exception {
        HttpResponse<String> response = get("/v1/account;jsessionid=x", jwtUtil.generateToken(user.getId()));

        assertThat(response.statusCode()).isEqualTo(400);
    }

    /** With mail off (the default) there is no SMTP server to reach, and an unreachable one is no reason for DOWN. */
    @Test
    void the_health_check_does_not_depend_on_the_mail_server() throws Exception {
        HttpResponse<String> response = get("/actuator/health", null);

        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        assertThat(jsonMapper.readTree(response.body()).get("status").asString()).isEqualTo("UP");
    }

    static Stream<Arguments> oversizedBodies() {
        return Stream.of(
            // The autosave: the cap belongs to the handler, not to a spelling of its URL. Tomcat, Spring Security and
            // Spring MVC all route the decoded path; MockMvc does not decode like the container, hence here.
            Arguments.of("PUT", "/v1/%62illets/5", 2L * MAX_DOCUMENT_BYTES),
            // Anonymous, and without a document: the small default cap.
            Arguments.of("POST", "/v1/auth/login", RequestBodyLimitAdvice.DEFAULT_LIMIT));
    }

    /**
     * Chunked, so only the cut-off in the stream can stop the body; whitespace in an unterminated object, so neither a
     * parser limit nor a full parse (MALFORMED_REQUEST) can be what answers.
     */
    @ParameterizedTest(name = "{0} {1}")
    @MethodSource("oversizedBodies")
    void an_oversized_body_is_cut_off_before_it_is_parsed(String method, String path, long limit) throws Exception {
        byte[] body = ("{" + " ".repeat(Math.toIntExact(3 * limit))).getBytes(StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .version(HttpClient.Version.HTTP_1_1)
            .header("Authorization", "Bearer " + jwtUtil.generateToken(user.getId()))
            .header("Content-Type", "application/json")
            .method(method, HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(body)))
            .build();

        HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).as(response.body()).isEqualTo(400);
        assertThat(jsonMapper.readTree(response.body()).get("errorCode").asString()).isEqualTo("VALIDATION_ERROR");
    }

    /**
     * It would read a whole form-encoded PUT, PATCH or DELETE body into memory, unbounded and before authentication.
     */
    @Test
    void no_form_content_filter_reads_a_body_before_authentication() {
        assertThat(context.getBeanNamesForType(FormContentFilter.class)).isEmpty();
    }
}
