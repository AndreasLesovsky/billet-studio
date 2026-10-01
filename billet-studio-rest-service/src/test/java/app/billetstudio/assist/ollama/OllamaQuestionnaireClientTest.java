package app.billetstudio.assist.ollama;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.SequencedMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

import app.billetstudio.assist.dto.AssistStatus;
import app.billetstudio.assist.exception.AssistUnavailableException;
import app.billetstudio.assist.questionnaire.ChoiceQuestion;
import app.billetstudio.assist.questionnaire.Questionnaire;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The client against a stand-in Ollama on a local port: what goes over the wire (the measured request), and that every
 * way Ollama can fail ends as ASSIST_UNAVAILABLE instead of a 500.
 */
class OllamaQuestionnaireClientTest {

    private static final String MODEL = "qwen2.5:14b";

    private final JsonMapper mapper = JsonMapper.builder().build();
    private final List<Request> requests = new CopyOnWriteArrayList<>();
    private HttpServer server;

    private record Request(String path, JsonNode body) {
    }

    private record Reply(int status, String body, Duration delay) {

        static Reply ok(String body) {
            return new Reply(200, body, Duration.ZERO);
        }
    }

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private OllamaQuestionnaireClient ollama(Function<Request, Reply> answer) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/", exchange -> respond(exchange, answer));
        server.start();
        return client("http://127.0.0.1:" + server.getAddress().getPort(), Duration.ofSeconds(5));
    }

    private OllamaQuestionnaireClient client(String url, Duration answerTimeout) {
        return new OllamaQuestionnaireClient(mapper, url, MODEL, "1h", answerTimeout, Duration.ofSeconds(5));
    }

    private void respond(HttpExchange exchange, Function<Request, Reply> answer) throws IOException {
        byte[] raw = exchange.getRequestBody().readAllBytes();
        JsonNode body = raw.length == 0 ? mapper.createObjectNode() : mapper.readTree(raw);
        Request request = new Request(exchange.getRequestURI().getPath(), body);
        requests.add(request);
        Reply reply = answer.apply(request);
        try {
            Thread.sleep(reply.delay());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        byte[] out = reply.body().getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(reply.status(), out.length);
        exchange.getResponseBody().write(out);
        exchange.close();
    }

    private static Questionnaire questionnaire() {
        SequencedMap<String, String> modes = new LinkedHashMap<>();
        modes.put("KEEP", "Nothing said.");
        modes.put("dark", "Dark.");
        SequencedMap<String, ChoiceQuestion> questions = new LinkedHashMap<>();
        questions.put("colorMode", new ChoiceQuestion("Light or dark?", modes));
        return new Questionnaire(questions);
    }

    private static boolean isLoad(Request request) {
        return request.body().path("messages").isEmpty();
    }

    private static Reply answering(String content) {
        return Reply.ok("{\"message\":{\"role\":\"assistant\",\"content\":" + quote(content) + "}}");
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    @Test
    void loads_the_model_with_the_answer_s_options_then_asks_with_the_schema() throws IOException {
        OllamaQuestionnaireClient client = ollama(request -> isLoad(request) ? Reply.ok("{\"done\":true}")
            : answering("{\"reasoning\":\"Dark mode is asked for.\",\"colorMode\":\"dark\"}"));

        client.awaitReady();
        Map<String, String> answers = client.answer(questionnaire(), "{\"conversation\":[]}");

        assertThat(answers).containsExactly(Map.entry("colorMode", "dark"));
        assertThat(requests).extracting(Request::path).containsExactly("/api/chat", "/api/chat");
        JsonNode load = requests.get(0).body();
        JsonNode chat = requests.get(1).body();
        assertThat(load.propertyNames()).containsExactly("model", "messages", "keep_alive", "options");
        assertThat(chat.propertyNames())
            .containsExactly("model", "messages", "format", "stream", "keep_alive", "options");
        for (JsonNode body : List.of(load, chat)) {
            assertThat(body.get("model").asString()).isEqualTo(MODEL);
            assertThat(body.get("keep_alive").asString()).isEqualTo("1h");
            assertThat(mapper.writeValueAsString(body.get("options"))).isEqualTo("{\"temperature\":0,\"num_ctx\":12288}");
        }
        assertThat(chat.get("stream").asBoolean()).isFalse();
        assertThat(chat.get("messages").get(0).get("role").asString()).isEqualTo("system");
        assertThat(chat.get("messages").get(1).get("content").asString()).endsWith("State:\n{\"conversation\":[]}");
        assertThat(chat.get("format").get("properties").propertyNames()).containsExactly("reasoning", "colorMode");
    }

    @Test
    void every_failure_of_ollama_is_assist_unavailable() throws IOException {
        List<Function<Request, Reply>> failures = List.of(
            request -> isLoad(request) ? Reply.ok("{}") : answering("{\"colorMode\":\"purple\"}"),
            request -> isLoad(request) ? Reply.ok("{}") : answering("no json"),
            request -> isLoad(request) ? Reply.ok("{}") : Reply.ok("{\"message\":{}}"),
            request -> new Reply(404, "{\"error\":\"model 'qwen2.5:14b' not found\"}", Duration.ZERO));
        for (Function<Request, Reply> failure : failures) {
            OllamaQuestionnaireClient client = ollama(failure);
            assertThatThrownBy(() -> {
                client.awaitReady();
                client.answer(questionnaire(), "{}");
            }).isInstanceOf(AssistUnavailableException.class);
            stop();
        }
    }

    @Test
    void a_slow_answer_and_a_server_that_is_not_there_are_assist_unavailable() throws IOException {
        ollama(request -> isLoad(request) ? Reply.ok("{}")
            : new Reply(200, "{}", Duration.ofSeconds(2)));
        OllamaQuestionnaireClient slow =
            client("http://127.0.0.1:" + server.getAddress().getPort(), Duration.ofMillis(300));
        assertThatThrownBy(() -> slow.answer(questionnaire(), "{}")).isInstanceOf(AssistUnavailableException.class);

        OllamaQuestionnaireClient absent = client("http://127.0.0.1:" + freePort(), Duration.ofSeconds(1));
        assertThatThrownBy(absent::awaitReady).isInstanceOf(AssistUnavailableException.class);
        assertThatThrownBy(() -> absent.answer(questionnaire(), "{}")).isInstanceOf(AssistUnavailableException.class);
        assertThat(absent.status()).isEqualTo(AssistStatus.OFFLINE);
    }

    @Test
    void the_status_asks_without_loading_anything() throws IOException {
        Map<String, String> lists = new java.util.concurrent.ConcurrentHashMap<>(Map.of(
            "/api/ps", "{\"models\":[]}",
            "/api/tags", "{\"models\":[{\"name\":\"llama3:8b\"}]}"));
        OllamaQuestionnaireClient client = ollama(request -> Reply.ok(lists.get(request.path())));

        assertThat(client.status()).isEqualTo(AssistStatus.OFFLINE);
        lists.put("/api/tags", "{\"models\":[{\"name\":\"" + MODEL + "\"}]}");
        assertThat(client.status()).isEqualTo(AssistStatus.IDLE);
        lists.put("/api/ps", "{\"models\":[{\"name\":\"" + MODEL + "\"}]}");
        assertThat(client.status()).isEqualTo(AssistStatus.READY);

        assertThat(requests).extracting(Request::path).doesNotContain("/api/chat");
    }

    @Test
    void a_load_already_running_is_shared() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        OllamaQuestionnaireClient client = ollama(request -> {
            if (isLoad(request)) {
                await(release);
                return Reply.ok("{}");
            }
            return answering("{\"colorMode\":\"KEEP\"}");
        });

        client.warmUp();
        client.warmUp();
        Thread asking = Thread.ofVirtual().start(() -> {
            client.awaitReady();
            client.answer(questionnaire(), "{}");
        });
        Thread.sleep(200);
        release.countDown();
        asking.join(Duration.ofSeconds(5));

        assertThat(requests.stream().filter(OllamaQuestionnaireClientTest::isLoad)).hasSize(1);
        assertThat(requests.stream().filter(request -> !isLoad(request))).hasSize(1);
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }
}
