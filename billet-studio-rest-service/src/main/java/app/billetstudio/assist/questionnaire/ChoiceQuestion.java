package app.billetstudio.assist.questionnaire;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.SequencedMap;

import org.jspecify.annotations.Nullable;

/**
 * Jev's choice question: the answer is exactly one label of {@code criteria}, in their order. A null description
 * leaves its label undescribed.
 */
public record ChoiceQuestion(String instructions, SequencedMap<String, @Nullable String> criteria) {

    public ChoiceQuestion {
        if (criteria.size() < 2) {
            throw new IllegalArgumentException("A choice question needs at least two labels");
        }
        criteria = Collections.unmodifiableSequencedMap(new LinkedHashMap<>(criteria));
    }
}
