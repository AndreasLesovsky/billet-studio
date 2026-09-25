package app.billetstudio.billet.document.validation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/** The rules of a billet document that span fields; see {@link BilletDocumentRulesValidator}. */
@Documented
@Constraint(validatedBy = BilletDocumentRulesValidator.class)
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidBilletDocument {

    String message() default "violates a billet document rule";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
