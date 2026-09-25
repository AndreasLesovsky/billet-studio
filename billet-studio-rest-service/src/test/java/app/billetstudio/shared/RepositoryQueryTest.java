package app.billetstudio.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

/**
 * The structural guard for the SQL channel: no query anywhere may read a clock or cut a calendar.
 *
 * Every DATETIME holds UTC written by the application, and "now" is the application's Instant.now() - never the
 * database server's clock, which may run in another zone. A calendar day for a human (a mail's deletion date) is
 * decided in Java over AppZone. Pulling a zone into SQL means CONVERT_TZ with a named zone, which answers NULL - not
 * an error - wherever the server's timezone tables were never loaded.
 *
 * Same shape as EmailTemplateRenderTest.no_template_formats_a_date_on_its_own, which guards the template channel:
 * read the sources, fail on the construct itself. Comments are stripped before the scan, so prose is free to name
 * the trap - only string literals count, and only in a file that writes queries.
 */
class RepositoryQueryTest {

    /** Anything that reads a clock or cuts a calendar. Matched inside query strings only. */
    private static final Pattern CALENDAR_SQL = Pattern.compile(
        "\\b(CONVERT_TZ|DATE_FORMAT|STR_TO_DATE|CURDATE|CURTIME|CURRENT_DATE|CURRENT_TIME"
            + "|CURRENT_TIMESTAMP|UTC_DATE|UTC_TIME|UTC_TIMESTAMP|SYSDATE|LOCALTIME"
            + "|LOCALTIMESTAMP|NOW|DATEDIFF|TIMESTAMPDIFF|TIMESTAMPADD|DATE_ADD|DATE_SUB"
            + "|ADDDATE|SUBDATE|EXTRACT|YEAR|MONTH|DAYOFMONTH|WEEK|QUARTER)\\s*\\(",
        Pattern.CASE_INSENSITIVE);

    /** JPQL's own clock keywords take no parentheses. */
    private static final Pattern JPQL_CLOCK = Pattern.compile(
        "\\b(CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|LOCAL\\s+DATE|LOCAL\\s+TIME|LOCAL\\s+DATETIME)\\b",
        Pattern.CASE_INSENSITIVE);

    /** What makes a string a query, and a file worth scanning. */
    private static final Pattern SQL_VERB = Pattern.compile("\\b(SELECT|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\b",
        Pattern.CASE_INSENSITIVE);

    private static final Pattern STRING_LITERAL = Pattern.compile("\"((?:\\\\.|[^\"\\\\])*)\"");
    private static final Pattern BLOCK_COMMENT = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);
    private static final Pattern LINE_COMMENT = Pattern.compile("//[^\\n]*");

    @Test
    void no_query_reads_a_clock_or_decides_a_calendar_boundary() throws IOException {
        Path sources = Path.of("src", "main", "java");
        assertThat(sources).as("backend sources - run from the module directory").isDirectory();
        // The scan must see the repositories at all, or the guard below passes on nothing.
        Path userRepository = sources.resolve(Path.of("app", "billetstudio", "auth", "repository",
            "UserRepository.java"));
        assertThat(stringLiteralsOf(stripComments(read(userRepository))))
            .as("the scan recognises the queries of UserRepository")
            .anyMatch(literal -> SQL_VERB.matcher(literal).find());

        try (Stream<Path> files = Files.walk(sources)) {
            List<String> offenders = files
                .filter(path -> path.toString().endsWith(".java"))
                .flatMap(path -> offencesIn(path, sources).stream())
                .toList();

            assertThat(offenders)
                .as("queries reading the database clock or cutting a calendar - pass an Instant from Java "
                    + "instead, and fold calendar days over AppZone")
                .isEmpty();
        }
    }

    private static List<String> offencesIn(Path file, Path sources) {
        List<String> literals = stringLiteralsOf(stripComments(read(file)));
        if (literals.stream().noneMatch(literal -> SQL_VERB.matcher(literal).find())) {
            return List.of();
        }
        List<String> offences = new ArrayList<>();
        for (String literal : literals) {
            for (Pattern pattern : List.of(CALENDAR_SQL, JPQL_CLOCK)) {
                Matcher offence = pattern.matcher(literal);
                while (offence.find()) {
                    offences.add(sources.relativize(file) + " -> " + offence.group(1));
                }
            }
        }
        return offences;
    }

    private static List<String> stringLiteralsOf(String source) {
        List<String> literals = new ArrayList<>();
        Matcher matcher = STRING_LITERAL.matcher(source);
        while (matcher.find()) {
            literals.add(matcher.group(1));
        }
        return literals;
    }

    private static String stripComments(String source) {
        return LINE_COMMENT.matcher(BLOCK_COMMENT.matcher(source).replaceAll(" ")).replaceAll(" ");
    }

    private static String read(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
