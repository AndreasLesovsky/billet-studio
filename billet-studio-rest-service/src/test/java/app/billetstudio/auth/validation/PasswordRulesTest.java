package app.billetstudio.auth.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.stream.Stream;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The limits are counted the way their reasons count: the minimum in characters a person types, the maximum in the
 * UTF-8 bytes BCrypt reads. With multi-byte characters the two part ways long before 72 characters.
 */
class PasswordRulesTest {

    static Stream<Arguments> passwords() {
        return Stream.of(
            Arguments.of("eight characters, one of each class", "Abcdefg1", true),
            Arguments.of("seven characters", "Abcdef1", false),
            Arguments.of("72 bytes of ASCII", "Aa1" + "x".repeat(69), true),
            Arguments.of("73 bytes of ASCII", "Aa1" + "x".repeat(70), false),
            Arguments.of("72 bytes in 38 characters", "Aa1b" + "ä".repeat(34), true),
            Arguments.of("74 bytes in only 39 characters", "Aa1b" + "ä".repeat(35), false),
            Arguments.of("no upper case", "alllowercase1", false),
            Arguments.of("no lower case", "ALLUPPERCASE1", false),
            Arguments.of("no digit", "NoDigitsInHere", false),
            // Same intent as the frontend check, so the backend never rejects what a user was told is fine.
            Arguments.of("non-ASCII letters count as letters", "Überprüf1", true));
    }

    @ParameterizedTest(name = "{0} -> {2}")
    @MethodSource("passwords")
    void aNewPasswordNeedsEveryClass_8Characters_andAtMost72Bytes(String description, String password,
        boolean valid) {
        assertThat(PasswordRules.isValid(password)).isEqualTo(valid);
    }
}
