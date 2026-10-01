package app.billetstudio.assist.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import app.billetstudio.assist.dto.AssistBilletDto;
import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistTurnDto;
import app.billetstudio.assist.questionnaire.Questionnaire;
import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.catalog.dto.ModelDefaultsDto;
import app.billetstudio.catalog.dto.ModelDto;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

/** The two ends around the model: what it is asked (questions, state) and how its labels become the next billet. */
class BilletQuestionnaireTest {

    private static final AssistBilletDto BIRTHDAY = new AssistBilletDto("geburtstag", "TEMPLATE_DEFAULT",
        "TEMPLATE_DEFAULT", "TEMPLATE_DEFAULT", "auto", "UI_LANGUAGE", "TEMPLATE_DEFAULT");

    private final BilletQuestionnaire questionnaire = new BilletQuestionnaire(JsonMapper.builder().build());

    private static ModelDto model(String slug, String nameEn, String nameDe, String occasion) {
        return new ModelDto(slug, nameDe, nameEn, occasion, "f", "p", 1L, null, true,
            new ModelDefaultsDto(1, 0, 1, 1, 0, 1));
    }

    private static AssistTurnDto user(String content) {
        return new AssistTurnDto("user", content, null);
    }

    private static AssistTurnDto assistant(AssistBilletDto billet) {
        return new AssistTurnDto("assistant", null, billet);
    }

    /** Every question KEEP, with the given exceptions. */
    private static Map<String, String> answers(String... questionAndLabel) {
        Map<String, String> answers = new LinkedHashMap<>();
        BilletQuestionnaire.QUESTIONS.forEach(question -> answers.put(question, "KEEP"));
        for (int i = 0; i < questionAndLabel.length; i += 2) {
            answers.put(questionAndLabel[i], questionAndLabel[i + 1]);
        }
        return answers;
    }

    @Test
    void asks_the_seven_questions_with_the_library_last_and_the_template_looks_spelled_out() {
        Questionnaire built = questionnaire.questionnaire(List.of(
            model("champagne-bottle", "Champagne bottle", "Champagnerflasche", "celebration"),
            model("gift-box", "Gift box", "Geschenk", "general")));

        assertThat(built.questions().keySet()).containsExactlyElementsOf(BilletQuestionnaire.QUESTIONS);
        assertThat(built.questions().get("model").criteria().keySet()).containsExactly(
            "KEEP", "TEMPLATE_DEFAULT", "NONE", "champagne-bottle", "gift-box", "NOT_SUPPORTED");
        assertThat(built.questions().get("model").criteria().get("champagne-bottle"))
            .isEqualTo("Champagne bottle (Champagnerflasche), occasion: celebration.");
        assertThat(built.questions().get("template").criteria().get("geburtstag"))
            .endsWith("Default look: theme peach, model birthday-cake, particles confetti, divider star.");
        assertThat(built.questions().values())
            .allSatisfy(question -> assertThat(question.instructions()).startsWith("`conversation` is a chat"));
    }

    @Test
    void the_state_is_the_chat_as_compact_json_with_the_billet_in_question_order() {
        String state = questionnaire.state(List.of(user("Geburtstag, schick"), assistant(BIRTHDAY), user("dunkel")));

        assertThat(state).isEqualTo("{\"conversation\":["
            + "{\"role\":\"user\",\"content\":\"Geburtstag, schick\"},"
            + "{\"role\":\"assistant\",\"billet\":{\"template\":\"geburtstag\",\"theme\":\"TEMPLATE_DEFAULT\","
            + "\"particles\":\"TEMPLATE_DEFAULT\",\"divider\":\"TEMPLATE_DEFAULT\",\"colorMode\":\"auto\","
            + "\"lang\":\"UI_LANGUAGE\",\"model\":\"TEMPLATE_DEFAULT\"}},"
            + "{\"role\":\"user\",\"content\":\"dunkel\"}]}");
    }

    @Test
    void refuses_a_conversation_the_frontend_never_sends() {
        AssistBilletDto keep = new AssistBilletDto("KEEP", "rose", "petal", "dot", "dark", "de", "gift-box");
        AssistBilletDto unknownTheme = new AssistBilletDto("BLANK", "violet", "petal", "dot", "dark", "de", "NONE");
        List<List<AssistTurnDto>> invalid = List.of(
            List.of(user("Hallo"), assistant(BIRTHDAY)),
            List.of(assistant(keep), user("Hallo")),
            List.of(assistant(unknownTheme), user("Hallo")),
            List.of(new AssistTurnDto("user", "Hallo", BIRTHDAY)),
            List.of(new AssistTurnDto("assistant", "Text", BIRTHDAY), user("Hallo")));

        for (List<AssistTurnDto> conversation : invalid) {
            assertThatThrownBy(() -> questionnaire.validate(conversation)).isInstanceOf(ValidationException.class);
        }
        questionnaire.validate(List.of(user("Hallo"), assistant(BIRTHDAY), user("lieber hell")));
    }

    @Test
    void keep_holds_a_value_and_template_default_follows_a_new_template() {
        AssistReply reply = questionnaire.merge(BIRTHDAY,
            answers("template", "weihnachten", "colorMode", "light", "model", "champagne-bottle"));

        assertThat(reply.billet()).isEqualTo(new AssistBilletDto("weihnachten", "TEMPLATE_DEFAULT", "TEMPLATE_DEFAULT",
            "TEMPLATE_DEFAULT", "light", "UI_LANGUAGE", "champagne-bottle"));
        assertThat(reply.notes()).isEmpty();
    }

    @Test
    void an_unsupported_wish_keeps_its_value_says_so_and_the_other_answers_still_count() {
        AssistReply reply = questionnaire.merge(null,
            answers("template", "BLANK", "colorMode", "dark", "model", "NOT_SUPPORTED", "particles", "NOT_SUPPORTED"));

        assertThat(reply.billet()).isEqualTo(new AssistBilletDto("BLANK", "TEMPLATE_DEFAULT", "TEMPLATE_DEFAULT",
            "TEMPLATE_DEFAULT", "dark", "UI_LANGUAGE", "TEMPLATE_DEFAULT"));
        assertThat(reply.notes()).containsExactly("PARTICLES_NOT_SUPPORTED", "MODEL_NOT_SUPPORTED");
    }

    @Test
    void a_message_about_something_else_changes_nothing() {
        AssistReply reply = questionnaire.merge(BIRTHDAY, answers("template", "NOT_SUPPORTED", "colorMode", "dark"));

        assertThat(reply.billet()).isEqualTo(BIRTHDAY);
        assertThat(reply.notes()).containsExactly("OFF_TOPIC");
    }

    @Test
    void all_keep_is_the_blank_start_on_the_first_message_and_no_change_later() {
        assertThat(questionnaire.merge(null, answers()))
            .isEqualTo(new AssistReply(BilletQuestionnaire.START, List.of("NOTHING_RECOGNISED")));
        assertThat(questionnaire.merge(BIRTHDAY, answers()))
            .isEqualTo(new AssistReply(BIRTHDAY, List.of("NO_CHANGE")));
    }
}
