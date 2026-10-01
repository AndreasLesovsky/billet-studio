package app.billetstudio.assist.questionnaire;

import java.util.Map;

import app.billetstudio.assist.dto.AssistStatus;

/**
 * Whatever answers a questionnaire: the local Ollama today (OllamaQuestionnaireClient). The questions are Jev's choice
 * questions, so a client for Jev's POST /v1/systemone could take its place.
 */
public interface QuestionnaireClient {

    /**
     * Waits until the model can answer (loading it if needed), so a caller can queue for answering only once it is
     * ready.
     *
     * @throws app.billetstudio.assist.exception.AssistUnavailableException
     *         when the model cannot be loaded in time
     */
    void awaitReady();

    /**
     * The chosen label of each question, by name.
     *
     * @param state
     *        the state the questions are about, as the prompt shows it
     * @throws app.billetstudio.assist.exception.AssistUnavailableException
     *         when no valid answer arrives in time
     */
    Map<String, String> answer(Questionnaire questionnaire, String state);

    /** Read-only: never loads the model. */
    AssistStatus status();

    /** Starts loading the model and returns at once. */
    void warmUp();
}
