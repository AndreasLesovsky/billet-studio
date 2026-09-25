package app.billetstudio.billet.document.validation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * Billet text: no C0 control character (U+0000-U+001F) and no DEL (U+007F), except the {@code \n} line break of the
 * inline markup; a tab is refused too. Every free-text field of the document must carry it.
 *
 * null is valid; pair with @NotNull.
 */
@Documented
@Constraint(validatedBy = NoControlCharactersValidator.class)
@Target({ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
public @interface NoControlCharacters {

    String message() default "must not contain control characters other than a line break";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
