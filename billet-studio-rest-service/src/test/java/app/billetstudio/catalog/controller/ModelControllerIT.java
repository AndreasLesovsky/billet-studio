package app.billetstudio.catalog.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.databind.JsonNode;

/**
 * The public model library against the real seed_models.sql. The expectations are read from tbl_models rather than
 * copied from the seed, so a regenerated seed leaves this file alone - only a wrong filter, order or mapping fails it.
 */
@Testcontainers(disabledWithoutDocker = true)
class ModelControllerIT extends WebITBase {

    /** DECIMAL(4,2) column -> ModelDefaultsDto field. */
    private static final Map<String, String> DEFAULTS = Map.of(
        "fit_size", "fitSize",
        "y_offset", "yOffset",
        "exposure", "exposure",
        "camera_distance", "cameraDistance",
        "camera_height", "cameraHeight",
        "auto_rotate_speed", "autoRotateSpeed");

    private List<Map<String, Object>> rows(String where) {
        return jdbc().queryForList("SELECT * FROM tbl_models WHERE " + where + " ORDER BY position, id");
    }

    /** Every column the DTO carries; URLs absolute against app.models.base-url, defaults as JSON numbers. */
    private static void assertModel(JsonNode model, Map<String, Object> row, boolean active) {
        assertThat(model.get("slug").asString()).isEqualTo(row.get("slug"));
        assertThat(model.get("nameDe").asString()).isEqualTo(row.get("name_de"));
        assertThat(model.get("nameEn").asString()).isEqualTo(row.get("name_en"));
        assertThat(model.get("occasion").asString()).isEqualTo(row.get("occasion"));
        assertThat(model.get("fileUrl").asString()).isEqualTo(MODELS_BASE_URL + row.get("file_path"));
        assertThat(model.get("previewUrl").asString()).isEqualTo(MODELS_BASE_URL + row.get("preview_path"));
        assertThat(model.get("fileSizeBytes").asLong()).isEqualTo(((Number) row.get("file_size_bytes")).longValue());
        assertThat(model.get("credit").isNull() ? null : model.get("credit").asString()).isEqualTo(row.get("credit"));
        assertThat(model.get("active").asBoolean()).isEqualTo(active);
        DEFAULTS.forEach((column, field) -> {
            JsonNode value = model.get("defaults").get(field);
            assertThat(value.isNumber()).as(field + " is a number").isTrue();
            assertThat(value.decimalValue()).as(field).isEqualByComparingTo((BigDecimal) row.get(column));
        });
    }

    @Test
    void theLibrary_listsActiveModelsOnly_inPositionOrder() throws Exception {
        List<Map<String, Object>> active = rows("active = 1");
        assertThat(active).as("the seed has active models").isNotEmpty();
        assertThat(rows("active = 0")).as("and inactive ones to leave out").isNotEmpty();

        MvcResult result = mockMvc.perform(get("/v1/models")).andReturn();

        assertThat(status(result)).isEqualTo(200);
        JsonNode models = body(result);
        assertThat(models.size()).isEqualTo(active.size());
        for (int i = 0; i < active.size(); i++) {
            assertModel(models.get(i), active.get(i), true);
        }
    }

    /** A retired model still resolves by slug, because existing billets use it. */
    @Test
    void aSingleModel_resolvesAnInactiveOne_andAnUnknownSlugIsModelNotFound() throws Exception {
        Map<String, Object> inactive = rows("active = 0").getFirst();

        MvcResult found = mockMvc.perform(get("/v1/models/{slug}", inactive.get("slug"))).andReturn();
        MvcResult unknown = mockMvc.perform(get("/v1/models/no-such-model")).andReturn();

        assertThat(status(found)).isEqualTo(200);
        assertModel(body(found), inactive, false);
        assertThat(status(unknown)).isEqualTo(404);
        assertThat(body(unknown).get("errorCode").asString()).isEqualTo("MODEL_NOT_FOUND");
    }
}
