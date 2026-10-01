package app.billetstudio.shared.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import app.billetstudio.auth.bootstrap.RootUserBootstrap;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * The model library served by the backend (app.models.directory) on a real servlet container: the mime type comes from
 * the container, and the security chain's own Cache-Control and CORS handling sit in front of the files. No database,
 * as in ServletContainerTest.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:mysql://127.0.0.1:1/unreachable",
    "spring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false",
    "spring.mail.host=127.0.0.1",
    "spring.mail.port=1",
    "app.mail.enabled=false",
    "app.assist.enabled=false",
    "app.security.enforce-strong-secrets=false",
    "app.upload.directory=target/model-files-test/uploads",
    "app.log.directory=target/model-files-test/logs",
    "app.cors.allowed-origins=" + ModelFilesTest.ORIGIN,
    "app.models.directory=target/model-files-test/models"
})
class ModelFilesTest {

    static final String ORIGIN = "https://billets.example";

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final Path ROOT = Path.of("target", "model-files-test");
    private static final Path MODELS = ROOT.resolve("models");
    private static final String SECRET = "must never be served";

    @LocalServerPort
    private int port;

    @MockitoBean
    private RootUserBootstrap rootUserBootstrap;

    @BeforeAll
    static void modelFiles() throws IOException {
        Files.createDirectories(MODELS.resolve("previews"));
        Files.writeString(MODELS.resolve("heart.v1.glb"), "glTF model bytes");
        Files.writeString(MODELS.resolve("previews/heart.v1.webp"), "RIFF preview bytes");
        // A stray file inside the directory, and a model-typed file right next to it.
        Files.writeString(MODELS.resolve("notes.txt"), SECRET);
        Files.writeString(ROOT.resolve("secret.glb"), SECRET);
    }

    private static HttpResponse<byte[]> get(int port, String path) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
            .header("Origin", ORIGIN)
            .GET()
            .build();
        return HTTP.send(request, HttpResponse.BodyHandlers.ofByteArray());
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({
        "heart.v1.glb,           model/gltf-binary",
        "previews/heart.v1.webp, image/webp"
    })
    void a_model_file_is_served_typed_immutable_and_readable_from_the_frontend(String file, String contentType)
        throws Exception {
        HttpResponse<byte[]> response = get(port, "/files/models/" + file);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo(Files.readAllBytes(MODELS.resolve(file)));
        assertThat(response.headers().firstValue("Content-Type")).hasValue(contentType);
        // Set by the handler; Spring Security's no-store default must not replace it.
        assertThat(response.headers().firstValue("Cache-Control")).hasValue("max-age=31536000, public, immutable");
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).hasValue(ORIGIN);
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {
        "/files/models/../secret.glb",
        "/files/models/%2e%2e/secret.glb",
        "/files/models/..%2fsecret.glb",
        "/files/models/..%5csecret.glb",
        "/files/models/%252e%252e/secret.glb",
        "/files/models/previews/..%2f..%2fsecret.glb",
        "/files/models/notes.txt"
    })
    void nothing_outside_the_model_files_is_served(String path) throws Exception {
        HttpResponse<byte[]> response = get(port, path);

        assertThat(response.statusCode()).isIn(400, 404);
        assertThat(new String(response.body(), StandardCharsets.UTF_8)).doesNotContain(SECRET);
    }

    /** A blank directory must not fall back to the working directory, where this very test put a .glb. */
    @Nested
    @TestPropertySource(properties = "app.models.directory=")
    class WithoutAModelsDirectory {

        @LocalServerPort
        private int serverPort;

        @Test
        void no_file_is_served() throws Exception {
            HttpResponse<byte[]> response = get(serverPort,
                "/files/models/target/model-files-test/models/heart.v1.glb");

            assertThat(response.statusCode()).isEqualTo(404);
        }
    }
}
