package app.billetstudio.shared.exception;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AssignableTypeFilter;

/**
 * Every domain exception answers with a code/status pair that docs/api-contract.md lists, because the frontend has
 * exactly one translated message per listed code. A new ApiException that is not in the contract fails here before
 * a user sees an untranslated key.
 */
class ApiErrorContractTest {

    private static final Path CONTRACT = Path.of("..", "docs", "api-contract.md");
    private static final Pattern CODE = Pattern.compile("`([A-Z][A-Z_]+)` (\\d{3})");

    @Test
    void every_api_exception_uses_a_code_and_status_from_the_contract() throws Exception {
        Map<String, Integer> contract = contractCodes();
        List<ApiException> exceptions = allApiExceptions();

        assertThat(exceptions).as("the scan finds the domain exceptions").hasSizeGreaterThan(10);
        assertThat(exceptions).allSatisfy(exception -> {
            String name = exception.getClass().getSimpleName();
            assertThat(contract).as(name + " -> " + exception.getErrorCode()).containsKey(exception.getErrorCode());
            assertThat(exception.getStatus().value()).as(name + " status")
                .isEqualTo(contract.get(exception.getErrorCode()));
        });
    }

    private static Map<String, Integer> contractCodes() throws IOException {
        String errors = Files.readString(CONTRACT).split("## Errors", 2)[1].split("\n## ", 2)[0];
        Map<String, Integer> codes = new HashMap<>();
        Matcher matcher = CODE.matcher(errors);
        while (matcher.find()) {
            codes.put(matcher.group(1), Integer.parseInt(matcher.group(2)));
        }
        assertThat(codes).as("codes parsed from " + CONTRACT).containsKeys("UNAUTHORIZED", "VALIDATION_ERROR");
        return codes;
    }

    private static List<ApiException> allApiExceptions() throws ReflectiveOperationException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AssignableTypeFilter(ApiException.class));
        List<ApiException> exceptions = new java.util.ArrayList<>();
        for (BeanDefinition candidate : scanner.findCandidateComponents("app.billetstudio")) {
            exceptions.add(instantiate(Class.forName(candidate.getBeanClassName())));
        }
        return exceptions;
    }

    /** Through the smallest public constructor; a String argument is only ever a log message or a role name. */
    private static ApiException instantiate(Class<?> type) throws ReflectiveOperationException {
        Constructor<?> constructor = Arrays.stream(type.getConstructors())
            .min(Comparator.comparingInt(Constructor::getParameterCount))
            .orElseThrow(() -> new IllegalStateException(type + " has no public constructor"));
        Object[] args = Arrays.stream(constructor.getParameterTypes())
            .map(parameter -> parameter == String.class ? "x" : null)
            .toArray();
        return (ApiException) constructor.newInstance(args);
    }
}
