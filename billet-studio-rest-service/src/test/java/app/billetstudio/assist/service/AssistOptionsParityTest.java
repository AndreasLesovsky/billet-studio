package app.billetstudio.assist.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import app.billetstudio.billet.document.Divider;
import app.billetstudio.billet.document.Particles;

import jakarta.validation.Validation;
import jakarta.validation.Validator;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The questionnaire's labels are the frontend's ids: themes and templates exist only there, so a theme or template
 * added (or a template's look changed) without its text here turns this red instead of never being suggested - or
 * being described wrongly to the model.
 */
class AssistOptionsParityTest {

    private static final Path FRONTEND = Path.of("..", "billet-studio-frontend", "src");
    private static final Path TEMPLATES = FRONTEND.resolve("app/billet/templates");
    private static final Set<String> SENTINELS = Set.of("KEEP", "TEMPLATE_DEFAULT", "NONE", "BLANK", "NOT_SUPPORTED",
        "UI_LANGUAGE");

    private final BilletQuestionnaire questionnaire = new BilletQuestionnaire(JsonMapper.builder().build());

    private List<String> values(String question) {
        return questionnaire.labels(question).stream().filter(label -> !SENTINELS.contains(label)).toList();
    }

    private static String read(Path file) throws IOException {
        return Files.readString(file);
    }

    /** The string items of `export const NAME = [...]` in a TypeScript file. */
    private static List<String> tsArray(Path file, String name) throws IOException {
        Matcher array = Pattern.compile(name + "[^=]*= \\[([^\\]]*)\\]", Pattern.DOTALL).matcher(read(file));
        assertThat(array.find()).as(name + " in " + file).isTrue();
        return quoted(array.group(1));
    }

    private static List<String> quoted(String text) {
        List<String> items = new ArrayList<>();
        Matcher item = Pattern.compile("'([^']*)'").matcher(text);
        while (item.find()) {
            items.add(item.group(1));
        }
        return items;
    }

    private static String tsValue(String source, String pattern) {
        Matcher value = Pattern.compile(pattern).matcher(source);
        assertThat(value.find()).as(pattern).isTrue();
        return value.group(1);
    }

    @Test
    void offers_every_theme_and_template_of_the_frontend() throws IOException {
        JsonNode themes = JsonMapper.builder().build().readTree(read(FRONTEND.resolve("styles/themes/themes.json")));
        List<String> themeIds = new ArrayList<>();
        themes.get("themes").forEach(theme -> themeIds.add(theme.get("id").asString()));

        assertThat(values("theme")).containsExactlyInAnyOrderElementsOf(themeIds);
        assertThat(values("template"))
            .containsExactlyInAnyOrderElementsOf(tsArray(TEMPLATES.resolve("templates.ts"), "TEMPLATE_IDS"));
    }

    @Test
    void describes_each_template_with_the_look_it_really_has() throws IOException {
        for (String id : values("template")) {
            String source = read(TEMPLATES.resolve(id + ".ts"));
            assertThat(questionnaire.defaultLook(id)).as(id).containsExactly(
                tsValue(source, "themeId: '([^']+)'"),
                tsValue(source, "modelSlug: '([^']+)'"),
                tsValue(source, "particles: '([^']+)'"),
                tsValue(source, "divider: '([^']+)'"));
        }
        String blank = read(TEMPLATES.resolve("blank.ts"));
        String defaultTheme =
            tsValue(read(FRONTEND.resolve("app/core/theme/theme-registry.generated.ts")), "DEFAULT_THEME[^=]*= '([^']+)'");
        assertThat(questionnaire.defaultLook("BLANK")).containsExactly(defaultTheme,
            tsValue(blank, "templateScene\\('([^']+)'"),
            tsValue(blank, "templateParticles\\('([^']+)'"),
            tsValue(blank, "style: '([^']+)'"));
    }

    @Test
    void offers_exactly_the_document_s_particle_shapes_divider_styles_colour_modes_and_languages() throws IOException {
        Path document = FRONTEND.resolve("app/billet/billet-document.ts");
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

        assertThat(values("particles")).containsExactlyElementsOf(tsArray(document, "PARTICLE_SHAPES"));
        assertThat(values("divider")).containsExactlyElementsOf(tsArray(document, "DIVIDER_STYLES"));
        assertThat(values("colorMode")).containsExactlyElementsOf(tsArray(document, "COLOR_MODES"));
        assertThat(values("lang")).containsExactlyElementsOf(tsArray(document, "BILLET_LANGS"));
        for (String shape : values("particles")) {
            assertThat(validator.validate(new Particles(true, shape, List.of("#ffffff"), 50, 1.0, 1.0))).isEmpty();
        }
        for (String style : values("divider")) {
            assertThat(validator.validate(new Divider(style))).isEmpty();
        }
    }
}
