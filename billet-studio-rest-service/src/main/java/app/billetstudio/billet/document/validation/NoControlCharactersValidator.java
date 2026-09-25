package app.billetstudio.billet.document.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class NoControlCharactersValidator implements ConstraintValidator<NoControlCharacters, CharSequence> {

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 0x20 && c != '\n' || c == 0x7F) {
                return false;
            }
        }
        return true;
    }
}
