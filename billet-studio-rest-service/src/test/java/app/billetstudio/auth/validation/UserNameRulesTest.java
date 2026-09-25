package app.billetstudio.auth.validation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The one name rule of every write path (registration, admin create/update, account edit), mirrored by the frontend.
 * Real names with umlauts, accents, hyphens and apostrophes must pass; digits, symbols and stray spaces must not.
 */
class UserNameRulesTest {

    @ParameterizedTest
    @ValueSource(strings = {"Jürgen", "Anne-Marie", "O'Brien", "Max Mustermann", "Abcdefghijklmnopqrstuvwxyzabcd"})
    void realNamesUpTo30Characters_areValid(String name) {
        assertThat(UserNameRules.isValid(name)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"andi99", "Max_Mustermann", "   ", " Max", "Max  Mustermann",
        "Abcdefghijklmnopqrstuvwxyzabcde"})
    void digitsSymbolsStraySpacesAndOverlongNames_areInvalid(String name) {
        assertThat(UserNameRules.isValid(name)).isFalse();
    }
}
