package app.billetstudio.assist.ollama;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import app.billetstudio.assist.dto.AssistStatus;
import app.billetstudio.assist.exception.AssistUnavailableException;
import app.billetstudio.assist.questionnaire.InvalidAnswerException;
import app.billetstudio.assist.questionnaire.Questionnaire;
import app.billetstudio.assist.questionnaire.QuestionnaireClient;

import lombok.extern.slf4j.Slf4j;

import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Answers a questionnaire with a local Ollama (POST /api/chat with the questionnaire's JSON schema as format): the port
 * of jev-demo's server/src/local-jev/ollama.ts. A question first waits for the model to be loaded (awaitReady) - a
 * shared load, started at most once at a time - and the load sends the same options as an answer, or Ollama would
 * load the model again with another context size.
 *
 * Neither the prompt nor the reply is ever logged: both carry the user's words.
 */
@Slf4j
@Component
public class OllamaQuestionnaireClient implements QuestionnaireClient {

    static final int CONTEXT_TOKENS = 12288;
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(2);
    /** As in the original: a cold load of a 14B model from disk can take minutes, and nobody waits for it here. */
    private static final Duration LOAD_REQUEST_TIMEOUT = Duration.ofSeconds(300);

    private final JsonMapper mapper;
    private final String model;
    private final String keepAlive;
    private final Duration loadWait;
    private final RestClient answering;
    private final RestClient loading;
    private final RestClient probing;
    private final Executor loader = command -> Thread.ofVirtual().name("assist-model-load").start(command);

    /** The load in progress; null when none is running. Guarded by this. */
    private @Nullable CompletableFuture<Void> load;

    public OllamaQuestionnaireClient(JsonMapper jsonMapper,
        @Value("${app.assist.url}") String url,
        @Value("${app.assist.model}") String model,
        @Value("${app.assist.keep-alive}") String keepAlive,
        @Value("${app.assist.timeout}") Duration answerTimeout,
        @Value("${app.assist.load-timeout}") Duration loadWait) {
        this.mapper = jsonMapper.rebuild().disable(SerializationFeature.INDENT_OUTPUT).build();
        this.model = model;
        this.keepAlive = keepAlive;
        this.loadWait = loadWait;
        HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(CONNECT_TIMEOUT)
            .build();
        this.answering = client(http, url, answerTimeout);
        this.loading = client(http, url, LOAD_REQUEST_TIMEOUT);
        this.probing = client(http, url, PROBE_TIMEOUT);
    }

    private static RestClient client(HttpClient http, String url, Duration readTimeout) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(readTimeout);
        return RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    @Override
    public Map<String, String> answer(Questionnaire questionnaire, String state) {
        ObjectNode body = mapper.createObjectNode().put("model", model);
        body.putArray("messages")
            .add(message("system", questionnaire.systemPrompt()))
            .add(message("user", questionnaire.userPrompt(state)));
        body.set("format", questionnaire.schema(mapper));
        body.put("stream", false);
        keepLoaded(body);
        try {
            JsonNode reply = mapper.readTree(post(answering, body));
            JsonNode content = reply.path("message").path("content");
            if (!content.isString()) {
                throw new AssistUnavailableException("Ollama replied without message content");
            }
            return questionnaire.readAnswers(content.asString(), mapper);
        } catch (InvalidAnswerException e) {
            throw new AssistUnavailableException("Ollama's answer is unusable: " + e.getMessage());
        } catch (RestClientException | JacksonException e) {
            throw new AssistUnavailableException("Ollama did not answer: " + e.getMessage());
        }
    }

    @Override
    public AssistStatus status() {
        try {
            if (lists(get("/api/ps"))) {
                return AssistStatus.READY;
            }
            if (lists(get("/api/tags"))) {
                return AssistStatus.IDLE;
            }
            log.warn("Ollama does not have {} - run: ollama pull {}", model, model);
        } catch (RestClientException | JacksonException e) {
            log.debug("Ollama is not reachable: {}", e.getMessage());
        }
        return AssistStatus.OFFLINE;
    }

    @Override
    public void warmUp() {
        startLoad();
    }

    @Override
    public void awaitReady() {
        try {
            startLoad().get(loadWait.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            throw new AssistUnavailableException("The model is still loading after " + loadWait);
        } catch (ExecutionException e) {
            throw new AssistUnavailableException("The model could not be loaded: " + e.getCause().getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssistUnavailableException("Interrupted while the model was loading");
        }
    }

    /** The running load, or a new one. A caller that stops waiting leaves it running, so a retry finds it done. */
    private synchronized CompletableFuture<Void> startLoad() {
        if (load != null) {
            return load;
        }
        CompletableFuture<Void> started = CompletableFuture.runAsync(this::sendLoad, loader);
        load = started;
        started.whenComplete((ignored, error) -> {
            if (error != null) {
                log.warn("Loading {} failed: {}", model, error.getMessage());
            }
            synchronized (this) {
                if (load == started) {
                    load = null;
                }
            }
        });
        return started;
    }

    /** A chat without messages only loads the model and keeps it for keep_alive. */
    private void sendLoad() {
        ObjectNode body = mapper.createObjectNode().put("model", model);
        body.putArray("messages");
        keepLoaded(body);
        post(loading, body);
    }

    /** keep_alive and options: what an answer and a load must share. */
    private void keepLoaded(ObjectNode body) {
        body.put("keep_alive", keepAlive);
        body.putObject("options").put("temperature", 0).put("num_ctx", CONTEXT_TOKENS);
    }

    private ObjectNode message(String role, String content) {
        return mapper.createObjectNode().put("role", role).put("content", content);
    }

    private String post(RestClient client, ObjectNode body) {
        String reply = client.post()
            .uri("/api/chat")
            .contentType(MediaType.APPLICATION_JSON)
            .body(mapper.writeValueAsString(body))
            .retrieve()
            .body(String.class);
        return reply != null ? reply : "";
    }

    private JsonNode get(String path) {
        String reply = probing.get().uri(path).retrieve().body(String.class);
        return mapper.readTree(reply != null ? reply : "{}");
    }

    /** Whether a model list of /api/ps or /api/tags names the model, with or without its implicit ":latest". */
    private boolean lists(JsonNode reply) {
        for (JsonNode entry : reply.path("models")) {
            String name = entry.path("name").asString("");
            if (name.equals(model) || name.equals(model + ":latest")) {
                return true;
            }
        }
        return false;
    }
}
