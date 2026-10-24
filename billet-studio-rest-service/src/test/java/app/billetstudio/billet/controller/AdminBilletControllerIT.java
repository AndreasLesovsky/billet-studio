package app.billetstudio.billet.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** /v1/admin/billets: an overview of every user's billets for admins only, without any billet content. */
@Testcontainers(disabledWithoutDocker = true)
class AdminBilletControllerIT extends WebITBase {

    private static final Path FIXTURE = Path.of("..", "docs", "fixtures", "muttertag.billet.json");

    private ObjectNode titled(String title) {
        try {
            ObjectNode document = (ObjectNode) jsonMapper.readTree(Files.readString(FIXTURE, StandardCharsets.UTF_8));
            document.put("title", title);
            return document;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private JsonNode created(User user, String title) throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/billets")
            .header(HttpHeaders.AUTHORIZATION, bearer(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("document", titled(title))))).andReturn();
        assertThat(status(result)).as("create: %s", content(result)).isEqualTo(201);
        return body(result);
    }

    private void publish(User user, JsonNode billet) throws Exception {
        MvcResult result = mockMvc.perform(post("/v1/billets/{id}/publish", billet.get("id").asLong())
            .header(HttpHeaders.AUTHORIZATION, bearer(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("version", billet.get("version").asLong())))).andReturn();
        assertThat(status(result)).as("publish: %s", content(result)).isEqualTo(200);
    }

    private MvcResult list(User user, MockHttpServletRequestBuilder request) throws Exception {
        if (user != null) {
            request.header(HttpHeaders.AUTHORIZATION, bearer(user));
        }
        return mockMvc.perform(request).andReturn();
    }

    @Test
    void adminSeesEveryOwnersBillets_withoutContent_andALinkOnlyWhenPublished() throws Exception {
        String marker = "adminlist" + uniqueEmail("x").replaceAll("\\W", "");
        User anna = createUser("Anna " + marker, uniqueEmail("anna"), "Irrelevant-1", Roles.USER);
        User ben = createUser("Ben " + marker, uniqueEmail("ben"), "Irrelevant-1", Roles.USER);
        User admin = createUser("Admin", uniqueEmail("admin"), "Irrelevant-1", Roles.ADMIN);
        publish(anna, created(anna, "Shared " + marker));
        created(ben, "Draft " + marker);

        MvcResult result = list(admin, get("/v1/admin/billets").param("q", marker).param("sort", "owner,asc"));

        assertThat(status(result)).as(content(result)).isEqualTo(200);
        JsonNode page = body(result);
        assertThat(page.get("totalRows").asLong()).isEqualTo(2);
        JsonNode shared = page.get("rows").get(0);
        JsonNode draft = page.get("rows").get(1);
        assertThat(shared.get("owner").get("email").asString()).isEqualTo(anna.getEmail());
        assertThat(shared.get("published").asBoolean()).isTrue();
        assertThat(shared.get("shareToken").asString()).hasSize(22);
        assertThat(draft.get("owner").get("name").asString()).isEqualTo(ben.getName());
        assertThat(draft.get("published").asBoolean()).isFalse();
        assertThat(draft.get("shareToken").isNull()).isTrue();
        // The overview never carries a billet's content.
        assertThat(content(result)).doesNotContain("\"document\"").doesNotContain("titleLine");

        JsonNode drafts = body(list(admin, get("/v1/admin/billets").param("q", marker).param("published", "false")));
        assertThat(drafts.get("rows").findValuesAsString("title")).isEqualTo(List.of("Draft " + marker));
    }

    @Test
    void onlyAdminsMayList() throws Exception {
        User user = createUser("Carla", uniqueEmail("carla"), "Irrelevant-1", Roles.USER);

        assertThat(status(list(user, get("/v1/admin/billets")))).isEqualTo(403);
        assertThat(status(list(null, get("/v1/admin/billets")))).isEqualTo(401);
    }

    @Test
    void anUnknownSortIsAValidationError() throws Exception {
        User admin = createUser("Admin", uniqueEmail("admin"), "Irrelevant-1", Roles.ADMIN);

        MvcResult result = list(admin, get("/v1/admin/billets").param("sort", "document,asc"));

        assertThat(status(result)).isEqualTo(400);
        assertThat(content(result)).contains("\"errorCode\":\"VALIDATION_ERROR\"");
    }
}
