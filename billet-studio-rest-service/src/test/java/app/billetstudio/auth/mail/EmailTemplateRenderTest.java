package app.billetstudio.auth.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Properties;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.thymeleaf.context.Context;

/**
 * Renders every mail template with a real Spring/Thymeleaf engine: a broken fragment expression or a missing
 * variable fails only at runtime, in a mail that was already due. The output also goes to
 * target/email-preview/, which is how a layout gets looked at without sending anything. The reset link and the
 * deletion date in the composed mail are AuthMailServiceTest.
 */
class EmailTemplateRenderTest {

    private static final List<String> TEMPLATES = List.of("welcome", "password-reset", "account-deactivation",
        "account-deletion-cancelled", "account-deleted", "account-deleted-by-admin");

    private static final Path PREVIEW_DIR = Path.of("target", "email-preview");

    private static final Pattern SHOP_WORDS = Pattern.compile("\\b(bestell\\w*|warenkorb\\w*|wunschliste\\w*"
        + "|produkt\\w*|bewertung\\w*|orders?|carts?|wishlists?|products?|reviews?|shop\\w*|commercex)\\b");

    static Stream<String> templateNames() {
        return TEMPLATES.stream().flatMap(t -> Stream.of(t + "_de", t + "_en"));
    }

    /** The union of everything any template reads, as AuthMailService sets it (no logo configured). */
    private static Context context(String lang) {
        Context ctx = new Context(Locale.forLanguageTag(lang));
        ctx.setVariable("siteName", "billet-studio");
        ctx.setVariable("logoUrl", null);
        ctx.setVariable("contactEmail", "kontakt@example.com");
        ctx.setVariable("frontendUrl", "https://billet.example.com");
        ctx.setVariable("greetingName", "Jürgen");
        ctx.setVariable("resetLink", "https://billet.example.com/reset-password?token=abc");
        ctx.setVariable("deletionDate", "22.10.2026");
        ctx.setVariable("loginUrl", "https://billet.example.com/login");
        return ctx;
    }

    @ParameterizedTest
    @MethodSource("templateNames")
    void every_template_renders_completely_in_its_language(String name) throws IOException {
        String lang = name.substring(name.length() - 2);
        String html = MailTestSupport.engine().process("email/" + name, context(lang));

        assertThat(html).contains("billet-studio").contains("kontakt@example.com");
        assertThat(html).doesNotContain("null").doesNotContain("th:text").doesNotContain("${");
        // An unresolved message key renders as ??KEY_de??; a leftover expression or attribute is a template bug.
        // (" th:" with the space: the CSS "max-width:" contains "th:".)
        assertThat(html).doesNotContain("??").doesNotContain("#{").doesNotContain("*{").doesNotContain(" th:");
        assertThat(html).contains(lang.equals("de") ? "Hallo Jürgen," : "Hello Jürgen,");
        assertThat(html).as("no logo configured, no <img>").doesNotContain("<img");
        // Ported from a shop: word boundaries, so the CSS "border" is no "order".
        assertThat(SHOP_WORDS.matcher(html.toLowerCase(Locale.ROOT)).find()).as("speaks about a shop").isFalse();
        writePreview(name, html);
    }

    /** Dates reach the templates as finished strings in the recipient's language (AuthMailService, AppZone). */
    @Test
    void no_template_formats_a_date_on_its_own() throws IOException, URISyntaxException {
        try (Stream<Path> files = Files.list(templateDir())) {
            List<String> offenders = files
                .filter(file -> read(file).contains("#temporals") || read(file).contains("#dates"))
                .map(file -> file.getFileName().toString())
                .toList();
            assertThat(offenders).isEmpty();
        }
    }

    /** A template added on disk but not to TEMPLATES would never be rendered here; each also needs both languages. */
    @Test
    void every_template_on_disk_is_rendered_here_in_both_languages() throws IOException, URISyntaxException {
        try (Stream<Path> files = Files.list(templateDir())) {
            List<String> onDisk = files
                .map(file -> file.getFileName().toString())
                .filter(file -> !file.startsWith("_"))
                .map(file -> file.substring(0, file.length() - ".html".length()))
                .toList();
            assertThat(onDisk).containsExactlyInAnyOrderElementsOf(templateNames().toList());
        }
    }

    @Test
    void both_message_bundles_have_the_same_keys() throws IOException {
        assertThat(load("messages_de.properties").stringPropertyNames())
            .isEqualTo(load("messages.properties").stringPropertyNames());
    }

    private static Properties load(String resource) throws IOException {
        Properties properties = new Properties();
        try (InputStream in = EmailTemplateRenderTest.class.getClassLoader().getResourceAsStream(resource)) {
            properties.load(Objects.requireNonNull(in, resource));
        }
        return properties;
    }

    private static Path templateDir() throws URISyntaxException {
        return Path.of(Objects.requireNonNull(
            EmailTemplateRenderTest.class.getClassLoader().getResource("templates/email")).toURI());
    }

    private static String read(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void writePreview(String name, String html) throws IOException {
        Files.createDirectories(PREVIEW_DIR);
        Files.writeString(PREVIEW_DIR.resolve(name + ".html"), html, StandardCharsets.UTF_8);
    }
}
