package app.billetstudio.assist;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import app.billetstudio.assist.dto.AssistBilletDto;
import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistTurnDto;
import app.billetstudio.assist.exception.AssistUnavailableException;
import app.billetstudio.assist.ollama.OllamaQuestionnaireClient;
import app.billetstudio.assist.service.BilletQuestionnaire;
import app.billetstudio.catalog.dto.ModelDefaultsDto;
import app.billetstudio.catalog.dto.ModelDto;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Measures the questionnaire against a real Ollama (docs/assist.md, "Measuring"): not part of the test run - the name
 * matches no surefire include - and skipped when no Ollama answers. Run it with
 * {@code mvnw.cmd test -Dtest=AssistEval}; ASSIST_EVAL_URL and ASSIST_EVAL_MODEL override the defaults.
 *
 * Each case is a conversation: every message goes through the real questionnaire, client and merge, and its billet
 * is what the next message is asked about. An expectation names only what the message decides; a set allows every
 * answer that would be right (a mood has more than one fitting theme). The report is printed, nothing is asserted:
 * the number is the result.
 */
class AssistEval {

    private static final String URL = env("ASSIST_EVAL_URL", "http://127.0.0.1:11434");
    private static final String MODEL = env("ASSIST_EVAL_MODEL", "qwen2.5:14b");

    /** The active seed models (sql/seed_models.sql), so a result does not depend on a database. */
    private static final List<ModelDto> LIBRARY = List.of(
        model("flower-bouquet", "Flower bouquet", "Blumenstrauß", "mothers_day"),
        model("heart-emoji", "Heart", "Herz", "valentines"),
        model("beating-heart", "Beating heart", "Schlagendes Herz", "valentines"),
        model("birthday-cake", "Birthday cake", "Geburtstagstorte", "birthday"),
        model("gift-box", "Gift box", "Geschenk", "general"),
        model("champagne-bottle", "Champagne bottle", "Champagnerflasche", "celebration"),
        model("snow-globe", "Snow globe", "Schneekugel", "christmas"));

    private record Turn(String message, Map<String, Set<String>> expected) {
    }

    private record Case(String name, List<Turn> turns) {
    }

    private static Turn turn(String message, String... questionAndAllowed) {
        Map<String, Set<String>> expected = new LinkedHashMap<>();
        for (int i = 0; i < questionAndAllowed.length; i += 2) {
            expected.put(questionAndAllowed[i], Set.of(questionAndAllowed[i + 1].split("\\|")));
        }
        return new Turn(message, expected);
    }

    private static Case conversation(String name, Turn... turns) {
        return new Case(name, List.of(turns));
    }

    /** "notes" expects the reply's notes joined with "," (empty: none). */
    private static final List<Case> CASES = List.of(
        conversation("the example sentence, then lighter",
            turn("Eine Geburtstagskarte für meinen Bruder, eher schick als bunt, mit Sektflasche statt Torte, im "
                    + "Dunkelmodus und auf Englisch",
                "template", "geburtstag", "theme", "midnight|dune|graphite|paper", "model", "champagne-bottle",
                "colorMode", "dark", "lang", "en", "notes", ""),
            turn("lieber hell", "template", "geburtstag", "model", "champagne-bottle", "colorMode", "light",
                "lang", "en", "notes", "")),
        conversation("cosy christmas in German",
            turn("Weihnachtsgrüße an die Familie, gemütlich und warm",
                "template", "weihnachten", "theme", "espresso|terracotta|peach|dune|rose", "lang", "de",
                "notes", "")),
        conversation("hearts as dividers, not as particles or model",
            turn("Eine Karte zum Valentinstag mit kleinen Herzen als Trenner",
                "template", "valentinstag", "divider", "heart", "model", "TEMPLATE_DEFAULT",
                "particles", "TEMPLATE_DEFAULT|heart")),
        conversation("a calm farewell without 3D",
            turn("Eine Abschiedskarte für meine Kollegin, ruhig und ohne 3D-Motiv",
                "template", "BLANK", "model", "NONE", "theme", "sage|paper|graphite|lavender|ocean|mint",
                "notes", "")),
        conversation("off topic",
            turn("Wie wird das Wetter morgen in Graz?", "notes", "OFF_TOPIC")),
        conversation("a model the library lacks",
            turn("Eine Geburtstagskarte mit einem Einhorn", "template", "geburtstag", "model", "TEMPLATE_DEFAULT",
                "notes", "MODEL_NOT_SUPPORTED")),
        conversation("particles the app lacks",
            turn("Eine Hochzeitskarte mit Sternschnuppen", "template", "hochzeit",
                "notes", "PARTICLES_NOT_SUPPORTED")),
        conversation("written in English, no language named",
            turn("A birthday card for my brother", "template", "geburtstag", "lang", "en")),
        conversation("German sentence, English billet",
            turn("Eine Muttertagskarte, bitte auf Englisch", "template", "muttertag", "lang", "en")),
        conversation("party colours",
            turn("Eine Karte zur Hochzeit, knallbunt wie eine Party", "template", "hochzeit", "theme", "neon")),
        conversation("a template switch keeps the template's own look",
            turn("Eine Weihnachtskarte", "template", "weihnachten", "theme", "TEMPLATE_DEFAULT"),
            turn("doch lieber zum Geburtstag", "template", "geburtstag", "theme", "TEMPLATE_DEFAULT",
                "model", "TEMPLATE_DEFAULT"),
            turn("ohne Partikel", "template", "geburtstag", "particles", "NONE"),
            turn("dunkel", "particles", "NONE", "colorMode", "dark")),
        conversation("gift instead of the template's model",
            turn("Valentinstag, aber mit einem Geschenk statt dem Herz", "template", "valentinstag",
                "model", "gift-box")));

    @Test
    void measure() throws Exception {
        assumeTrue(reachable(), "No Ollama at " + URL);
        JsonMapper mapper = JsonMapper.builder().build();
        BilletQuestionnaire questionnaire = new BilletQuestionnaire(mapper);
        OllamaQuestionnaireClient client = new OllamaQuestionnaireClient(mapper, URL, MODEL, "1h",
            Duration.ofSeconds(60), Duration.ofSeconds(300));

        long loadStarted = System.nanoTime();
        client.awaitReady();
        long loadMs = (System.nanoTime() - loadStarted) / 1_000_000;

        Map<String, int[]> perQuestion = new TreeMap<>();
        List<Long> latencies = new ArrayList<>();
        int turns = 0;
        int correctTurns = 0;
        StringBuilder failures = new StringBuilder();
        for (Case evalCase : CASES) {
            List<AssistTurnDto> chat = new ArrayList<>();
            for (Turn turn : evalCase.turns()) {
                chat.add(new AssistTurnDto("user", turn.message(), null));
                long started = System.nanoTime();
                AssistReply reply;
                try {
                    reply = questionnaire.merge(BilletQuestionnaire.offered(chat),
                        client.answer(questionnaire.questionnaire(LIBRARY), questionnaire.state(chat)));
                } catch (AssistUnavailableException e) {
                    failures.append("  ").append(evalCase.name()).append(" / ").append(turn.message())
                        .append(": no answer - ").append(e.getMessage()).append('\n');
                    turns++;
                    break;
                }
                latencies.add((System.nanoTime() - started) / 1_000_000);
                turns++;
                boolean allRight = true;
                for (Map.Entry<String, Set<String>> expected : turn.expected().entrySet()) {
                    String actual = actual(reply, expected.getKey());
                    boolean right = expected.getValue().contains(actual);
                    int[] score = perQuestion.computeIfAbsent(expected.getKey(), key -> new int[2]);
                    score[0] += right ? 1 : 0;
                    score[1]++;
                    if (!right) {
                        allRight = false;
                        failures.append("  ").append(evalCase.name()).append(" / \"").append(turn.message())
                            .append("\": ").append(expected.getKey()).append(" = ").append(actual)
                            .append(", expected ").append(expected.getValue()).append('\n');
                    }
                }
                correctTurns += allRight ? 1 : 0;
                if (!reply.notes().contains("OFF_TOPIC") && !reply.notes().contains("NO_CHANGE")) {
                    chat.add(new AssistTurnDto("assistant", null, reply.billet()));
                }
            }
        }

        List<Long> sorted = latencies.stream().sorted().toList();
        StringBuilder report = new StringBuilder("\n=== AssistEval: ").append(MODEL).append(" at ").append(URL)
            .append('\n').append("Ollama ").append(ollamaVersion()).append(", model digest ").append(digest())
            .append('\n').append("Loading the model took ").append(loadMs).append(" ms")
            .append('\n').append("Turns entirely right: ").append(correctTurns).append('/').append(turns).append('\n');
        perQuestion.forEach((question, score) -> report.append("  ").append(question).append(": ")
            .append(score[0]).append('/').append(score[1]).append('\n'));
        if (!sorted.isEmpty()) {
            report.append("Latency ms: median ").append(sorted.get(sorted.size() / 2)).append(", max ")
                .append(sorted.getLast()).append('\n');
        }
        report.append(failures.isEmpty() ? "No misses.\n" : "Misses:\n" + failures);
        System.out.println(report);
    }

    private static String actual(AssistReply reply, String question) {
        AssistBilletDto billet = reply.billet();
        return switch (question) {
            case "notes" -> String.join(",", reply.notes());
            case "template" -> billet.template();
            case "theme" -> billet.theme();
            case "particles" -> billet.particles();
            case "divider" -> billet.divider();
            case "colorMode" -> billet.colorMode();
            case "lang" -> billet.lang();
            case "model" -> billet.model();
            default -> throw new IllegalArgumentException(question);
        };
    }

    private static boolean reachable() {
        try {
            get("/api/version");
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String ollamaVersion() throws Exception {
        return JsonMapper.builder().build().readTree(get("/api/version")).path("version").asString("?");
    }

    private static String digest() throws Exception {
        for (JsonNode model : JsonMapper.builder().build().readTree(get("/api/tags")).path("models")) {
            if (MODEL.equals(model.path("name").asString(""))) {
                return model.path("digest").asString("?");
            }
        }
        return "? (" + MODEL + " not pulled)";
    }

    private static String get(String path) throws Exception {
        try (HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            HttpRequest request = HttpRequest.newBuilder(URI.create(URL + path)).timeout(Duration.ofSeconds(5)).build();
            return http.send(request, HttpResponse.BodyHandlers.ofString()).body();
        }
    }

    private static ModelDto model(String slug, String nameEn, String nameDe, String occasion) {
        return new ModelDto(slug, nameDe, nameEn, occasion, "", "", 1L, null, true,
            new ModelDefaultsDto(1.6, -0.08, 0.6, 2.8, 0.1, 0.45));
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
