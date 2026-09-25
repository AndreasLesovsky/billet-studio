package app.billetstudio.billet.document.validation;

import java.math.BigDecimal;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** Decimal arithmetic, so 23.75 is a multiple of 0.25 without a floating-point epsilon. */
public class MultipleOfValidator implements ConstraintValidator<MultipleOf, Number> {

    private BigDecimal step;

    @Override
    public void initialize(MultipleOf annotation) {
        step = BigDecimal.valueOf(annotation.value());
    }

    @Override
    public boolean isValid(Number value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        double number = value.doubleValue();
        if (!Double.isFinite(number)) {
            return false;
        }
        return BigDecimal.valueOf(number).remainder(step).signum() == 0;
    }
}
