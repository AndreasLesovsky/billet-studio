package app.billetstudio.assist.questionnaire;

/** The model's reply is no JSON object, or a question is missing or answered with a label it does not offer. */
public class InvalidAnswerException extends RuntimeException {

    public InvalidAnswerException(String message) {
        super(message);
    }
}
