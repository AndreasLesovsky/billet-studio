package app.billetstudio.assist.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.SequencedMap;
import java.util.Set;
import java.util.regex.Pattern;

import app.billetstudio.assist.dto.AssistBilletDto;
import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistTurnDto;
import app.billetstudio.assist.questionnaire.ChoiceQuestion;
import app.billetstudio.assist.questionnaire.Questionnaire;
import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.catalog.dto.ModelDto;

import org.jspecify.annotations.Nullable;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The seven questions that turn a chat into the start of a billet (docs/assist.md), their wording from
 * assist/billet-questionnaire.json and the model labels from the library. Also the two ends around the model: the
 * chat as the questionnaire's state, and the answers merged into the billet offered so far.
 */
@Component
public class BilletQuestionnaire {

    public static final String KEEP = "KEEP";
    public static final String NOT_SUPPORTED = "NOT_SUPPORTED";
    static final String TEMPLATE_DEFAULT = "TEMPLATE_DEFAULT";
    static final String NONE = "NONE";
    static final String BLANK = "BLANK";
    static final String UI_LANGUAGE = "UI_LANGUAGE";

    /** Question order = prompt order; model last, it is the only list that changes (with the library). */
    public static final List<String> QUESTIONS =
        List.of("template", "theme", "particles", "divider", "colorMode", "lang", "model");

    /** Where a chat starts: what /billets/new does without any start params. */
    static final AssistBilletDto START = new AssistBilletDto(BLANK, TEMPLATE_DEFAULT, TEMPLATE_DEFAULT,
        TEMPLATE_DEFAULT, "auto", UI_LANGUAGE, TEMPLATE_DEFAULT);

    private static final String RESOURCE = "assist/billet-questionnaire.json";
    private static final Pattern MODEL_SLUG = Pattern.compile("^[a-z0-9-]{1,60}$");

    private final JsonMapper mapper;
    private final JsonNode definition;

    public BilletQuestionnaire(JsonMapper jsonMapper) {
        this.mapper = jsonMapper.rebuild().disable(SerializationFeature.INDENT_OUTPUT).build();
        this.definition = load(mapper);
        for (String name : QUESTIONS) {
            if (!definition.path("questions").path(name).path("criteria").isObject()) {
                throw new IllegalStateException(RESOURCE + " has no criteria for " + name);
            }
        }
    }

    private static JsonNode load(JsonMapper mapper) {
        try (InputStream in = new ClassPathResource(RESOURCE).getInputStream()) {
            return mapper.readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + RESOURCE, e);
        }
    }

    /** The questionnaire for the active library models, in library order. */
    public Questionnaire questionnaire(List<ModelDto> library) {
        SequencedMap<String, ChoiceQuestion> questions = new LinkedHashMap<>();
        for (String name : QUESTIONS) {
            JsonNode question = definition.path("questions").path(name);
            SequencedMap<String, String> criteria = criteria(question);
            if (name.equals("template")) {
                describeDefaultLooks(criteria, question.path("defaultLooks"));
            }
            if (name.equals("model")) {
                String option = question.path("library").asString();
                for (ModelDto model : library) {
                    criteria.put(model.slug(), option.formatted(model.nameEn(), model.nameDe(), model.occasion()));
                }
                criteria.put(NOT_SUPPORTED, question.path("unsupported").asString());
            }
            String instructions = definition.path("preamble").asString() + " " + question.path("instructions").asString();
            questions.put(name, new ChoiceQuestion(instructions, criteria));
        }
        return new Questionnaire(questions);
    }

    private static SequencedMap<String, String> criteria(JsonNode question) {
        SequencedMap<String, String> criteria = new LinkedHashMap<>();
        question.path("criteria").properties().forEach(entry -> criteria.put(entry.getKey(), entry.getValue().asString()));
        return criteria;
    }

    /** A template's look is what TEMPLATE_DEFAULT means, so its option says what that is. */
    private static void describeDefaultLooks(SequencedMap<String, String> criteria, JsonNode looks) {
        looks.properties().forEach(entry -> {
            JsonNode look = entry.getValue();
            criteria.computeIfPresent(entry.getKey(), (label, description) -> description
                + " Default look: theme " + look.path("theme").asString()
                + ", model " + look.path("model").asString()
                + ", particles " + look.path("particles").asString()
                + ", divider " + look.path("divider").asString() + ".");
        });
    }

    /** The labels a question offers. */
    public Set<String> labels(String question) {
        return criteria(definition.path("questions").path(question)).keySet();
    }

    /** Theme, model, particles and divider a template (or BLANK) is described with. */
    List<String> defaultLook(String template) {
        JsonNode look = definition.path("questions").path("template").path("defaultLooks").path(template);
        return List.of(look.path("theme").asString(), look.path("model").asString(),
            look.path("particles").asString(), look.path("divider").asString());
    }

    /**
     * Checks what the bean constraints cannot: the conversation ends with the user's new message, a user entry holds
     * only text and an assistant entry only a billet of known labels.
     *
     * @throws ValidationException
     *         for the first rule that fails
     */
    public void validate(List<AssistTurnDto> conversation) {
        if (!conversation.getLast().isUser()) {
            throw new ValidationException("The conversation does not end with a user message");
        }
        for (AssistTurnDto turn : conversation) {
            if (turn.isUser() ? turn.content() == null || turn.billet() != null
                : turn.billet() == null || turn.content() != null) {
                throw new ValidationException("A " + turn.role() + " entry has the wrong fields");
            }
            if (turn.billet() != null) {
                for (String question : QUESTIONS) {
                    if (!isOffered(question, value(turn.billet(), question))) {
                        throw new ValidationException("Unknown " + question + " label in the conversation");
                    }
                }
            }
        }
    }

    /** A label a billet may hold: any but KEEP and NOT_SUPPORTED; for model also a slug, retired ones included. */
    private boolean isOffered(String question, String label) {
        if (label.equals(KEEP) || label.equals(NOT_SUPPORTED)) {
            return false;
        }
        if (question.equals("model") && MODEL_SLUG.matcher(label).matches()) {
            return true;
        }
        return labels(question).contains(label);
    }

    /** The chat as the questionnaire's state: compact JSON, no nulls, billet labels in question order. */
    public String state(List<AssistTurnDto> conversation) {
        ObjectNode state = mapper.createObjectNode();
        ArrayNode entries = state.putArray("conversation");
        for (AssistTurnDto turn : conversation) {
            ObjectNode entry = entries.addObject().put("role", turn.role());
            if (turn.isUser()) {
                entry.put("content", turn.content());
            } else {
                ObjectNode billet = entry.putObject("billet");
                QUESTIONS.forEach(question -> billet.put(question, value(turn.billet(), question)));
            }
        }
        return mapper.writeValueAsString(state);
    }

    /** The billet offered last before the new message; null on the first message. */
    public static @Nullable AssistBilletDto offered(List<AssistTurnDto> conversation) {
        for (AssistTurnDto turn : conversation.reversed()) {
            if (turn.billet() != null) {
                return turn.billet();
            }
        }
        return null;
    }

    /**
     * The answers on top of the billet offered so far. KEEP keeps a value, NOT_SUPPORTED keeps it too and says so; a
     * message that is not about a billet at all changes nothing.
     */
    public AssistReply merge(@Nullable AssistBilletDto offered, Map<String, String> answers) {
        AssistBilletDto base = offered != null ? offered : START;
        if (NOT_SUPPORTED.equals(answers.get("template"))) {
            return new AssistReply(base, List.of("OFF_TOPIC"));
        }
        Map<String, String> merged = new LinkedHashMap<>();
        List<String> notes = new ArrayList<>();
        for (String question : QUESTIONS) {
            String answer = answers.get(question);
            if (KEEP.equals(answer) || NOT_SUPPORTED.equals(answer)) {
                merged.put(question, value(base, question));
                if (NOT_SUPPORTED.equals(answer)) {
                    notes.add(question.toUpperCase(Locale.ROOT) + "_NOT_SUPPORTED");
                }
            } else {
                merged.put(question, answer);
            }
        }
        if (answers.values().stream().allMatch(KEEP::equals)) {
            notes.add(offered == null ? "NOTHING_RECOGNISED" : "NO_CHANGE");
        }
        return new AssistReply(billetOf(merged), List.copyOf(notes));
    }

    private static String value(AssistBilletDto billet, String question) {
        return switch (question) {
            case "template" -> billet.template();
            case "theme" -> billet.theme();
            case "particles" -> billet.particles();
            case "divider" -> billet.divider();
            case "colorMode" -> billet.colorMode();
            case "lang" -> billet.lang();
            case "model" -> billet.model();
            default -> throw new IllegalArgumentException("No question " + question);
        };
    }

    private static AssistBilletDto billetOf(Map<String, String> values) {
        return new AssistBilletDto(values.get("template"), values.get("theme"), values.get("particles"),
            values.get("divider"), values.get("colorMode"), values.get("lang"), values.get("model"));
    }
}
