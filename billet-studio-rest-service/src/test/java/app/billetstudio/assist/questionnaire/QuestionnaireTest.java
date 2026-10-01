package app.billetstudio.assist.questionnaire;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.SequencedMap;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

/**
 * The prompt layout is what the measurements in docs/assist.md were made with (jev-demo's questionnaire.ts): any
 * change to it is a change in answer quality, so it is pinned character for character here.
 */
class QuestionnaireTest {

    private final JsonMapper mapper = JsonMapper.builder().build();

    private static Questionnaire flight() {
        SequencedMap<String, String> places = new LinkedHashMap<>();
        places.put("Graz", null);
        places.put("Hamburg", null);
        places.put("NOT_DEFINED", "No destination is named.");
        SequencedMap<String, String> moods = new LinkedHashMap<>();
        moods.put("calm", "Quiet.");
        moods.put("loud", "Noisy.");
        SequencedMap<String, ChoiceQuestion> questions = new LinkedHashMap<>();
        questions.put("destination", new ChoiceQuestion("Where does the traveller want to go?", places));
        questions.put("mood", new ChoiceQuestion("How does it sound?", moods));
        return new Questionnaire(questions);
    }

    @Test
    void the_prompt_has_the_measured_layout_questions_before_the_state() {
        Questionnaire questionnaire = flight();

        assertThat(questionnaire.systemPrompt()).isEqualTo("You fill in a questionnaire about a state. Answer each "
            + "question from the state alone, following the wording of the question and the descriptions of its "
            + "options closely. A question with options takes exactly one option label, spelled as listed. A question "
            + "marked (true or false) takes true or false. Reply with JSON only. Start with `reasoning`: a few short "
            + "sentences that work out what the state says about the questions. Then give the answers.");
        assertThat(questionnaire.userPrompt("{\"conversation\":[]}")).isEqualTo("""
            Questions:

            destination: Where does the traveller want to go?
            Options: Graz, Hamburg
            Option NOT_DEFINED: No destination is named.

            mood: How does it sound?
            Option calm: Quiet.
            Option loud: Noisy.

            State:
            {"conversation":[]}""");
    }

    @Test
    void the_schema_starts_with_a_short_reasoning_and_offers_each_question_its_labels() {
        String schema = mapper.writeValueAsString(flight().schema(mapper));

        assertThat(schema).isEqualTo("{\"type\":\"object\",\"properties\":{"
            + "\"reasoning\":{\"type\":\"string\",\"maxLength\":300},"
            + "\"destination\":{\"type\":\"string\",\"enum\":[\"Graz\",\"Hamburg\",\"NOT_DEFINED\"]},"
            + "\"mood\":{\"type\":\"string\",\"enum\":[\"calm\",\"loud\"]}},"
            + "\"required\":[\"reasoning\",\"destination\",\"mood\"]}");
    }

    @Test
    void reads_the_labels_and_drops_the_reasoning() {
        String reply = "{\"reasoning\":\"Hamburg is named.\",\"destination\":\"Hamburg\",\"mood\":\"calm\"}";

        assertThat(flight().readAnswers(reply, mapper)).containsExactly(
            java.util.Map.entry("destination", "Hamburg"), java.util.Map.entry("mood", "calm"));
    }

    @Test
    void refuses_a_reply_that_is_not_one_of_the_labels() {
        Questionnaire questionnaire = flight();

        for (String reply : new String[] {
            "{\"destination\":\"Hamburg\"}",
            "{\"destination\":\"hamburg\",\"mood\":\"calm\"}",
            "{\"destination\":\"Hamburg\",\"mood\":true}",
            "[\"Hamburg\"]",
            "not json"}) {
            assertThatThrownBy(() -> questionnaire.readAnswers(reply, mapper))
                .as(reply)
                .isInstanceOf(InvalidAnswerException.class);
        }
    }
}
