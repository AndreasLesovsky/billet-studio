package app.billetstudio.assist.questionnaire;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.SequencedMap;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * A set of choice questions as one structured-output request: the port of jev-demo's local stand-in for Jev
 * (server/src/local-jev/questionnaire.ts). docs/assist.md holds the rules this layout was measured with - the system
 * text word for word, the questions before the state (the stable prefix stays in the model's prompt cache), the real
 * question names as JSON keys, a short reasoning field first. Change none of it without measuring again.
 */
public final class Questionnaire {

    static final int REASONING_CHARACTERS = 300;

    private final SequencedMap<String, ChoiceQuestion> questions;
    private final String reasoningKey;

    public Questionnaire(SequencedMap<String, ChoiceQuestion> questions) {
        if (questions.isEmpty()) {
            throw new IllegalArgumentException("A questionnaire needs at least one question");
        }
        this.questions = Collections.unmodifiableSequencedMap(new LinkedHashMap<>(questions));
        String key = "reasoning";
        while (questions.containsKey(key)) {
            key = "_" + key;
        }
        this.reasoningKey = key;
    }

    public SequencedMap<String, ChoiceQuestion> questions() {
        return questions;
    }

    public String systemPrompt() {
        return "You fill in a questionnaire about a state. Answer each question from the state alone, following the "
            + "wording of the question and the descriptions of its options closely. A question with options takes "
            + "exactly one option label, spelled as listed. A question marked (true or false) takes true or false. "
            + "Reply with JSON only. Start with `" + reasoningKey + "`: a few short sentences that work out what the "
            + "state says about the questions. Then give the answers.";
    }

    /** The questions first, the state last: only the end of the prompt changes from one request to the next. */
    public String userPrompt(String state) {
        List<String> blocks = new ArrayList<>();
        questions.forEach((name, question) -> blocks.add(describe(name, question)));
        return "Questions:\n\n" + String.join("\n\n", blocks) + "\n\nState:\n" + state;
    }

    /** Undescribed labels share one "Options:" line ahead of the described ones, as in the original. */
    private static String describe(String name, ChoiceQuestion question) {
        List<String> lines = new ArrayList<>();
        lines.add(name + ": " + question.instructions());
        List<String> undescribed = question.criteria().entrySet().stream()
            .filter(entry -> entry.getValue() == null)
            .map(Map.Entry::getKey)
            .toList();
        if (!undescribed.isEmpty()) {
            lines.add("Options: " + String.join(", ", undescribed));
        }
        question.criteria().forEach((label, description) -> {
            if (description != null) {
                lines.add("Option " + label + ": " + description);
            }
        });
        return String.join("\n", lines);
    }

    /** The reasoning field first, then one enum per question; an ObjectNode keeps this order on the wire. */
    public ObjectNode schema(JsonMapper mapper) {
        ObjectNode schema = mapper.createObjectNode();
        schema.put("type", "object");
        ObjectNode properties = schema.putObject("properties");
        properties.putObject(reasoningKey).put("type", "string").put("maxLength", REASONING_CHARACTERS);
        ArrayNode required = mapper.createArrayNode().add(reasoningKey);
        questions.forEach((name, question) -> {
            ObjectNode property = properties.putObject(name).put("type", "string");
            ArrayNode labels = property.putArray("enum");
            question.criteria().keySet().forEach(labels::add);
            required.add(name);
        });
        schema.set("required", required);
        return schema;
    }

    /**
     * The chosen label of each question, by question name. The reasoning is dropped: it never leaves this method.
     *
     * @throws InvalidAnswerException
     *         when the content is no JSON object or a question is missing or answered with a label it does not offer
     */
    public Map<String, String> readAnswers(String content, JsonMapper mapper) {
        JsonNode reply;
        try {
            reply = mapper.readTree(content);
        } catch (JacksonException e) {
            throw new InvalidAnswerException("The reply is not JSON");
        }
        if (reply == null || !reply.isObject()) {
            throw new InvalidAnswerException("The reply is not a JSON object");
        }
        Map<String, String> answers = new LinkedHashMap<>();
        questions.forEach((name, question) -> {
            JsonNode value = reply.get(name);
            if (value == null || !value.isString() || !question.criteria().containsKey(value.asString())) {
                throw new InvalidAnswerException(name + " is not answered with one of its labels");
            }
            answers.put(name, value.asString());
        });
        return Collections.unmodifiableMap(answers);
    }
}
