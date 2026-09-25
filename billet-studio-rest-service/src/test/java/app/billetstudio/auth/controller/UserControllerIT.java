package app.billetstudio.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.support.WebITBase;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.databind.JsonNode;

/**
 * The admin user API against MariaDB: the search query (LIKE with the '!' escape, case-insensitive name/email
 * match, the role sort through the join), the create/update/lock/delete round trip and what the editor does to the
 * sessions of the account it edits. Every list query filters on a tag unique to the test, because the shared database
 * holds the users of every other IT as well.
 */
@Testcontainers(disabledWithoutDocker = true)
class UserControllerIT extends WebITBase {

    private static final String PASSWORD = "Correct-horse-9";

    private String tag;
    private String admin;

    @BeforeEach
    void setUp() {
        tag = UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        admin = bearer(root());
    }

    private User seed(String name, String localPart, String role, boolean active) {
        User user = createUser(name, localPart + "." + tag + "@list.test", PASSWORD, role);
        if (!active) {
            user.setActive(false);
            user = userRepository.save(user);
        }
        return user;
    }

    private MvcResult as(String bearer, MockHttpServletRequestBuilder request) throws Exception {
        return mockMvc.perform(request.header(HttpHeaders.AUTHORIZATION, bearer)).andReturn();
    }

    private JsonNode list(String... params) throws Exception {
        MockHttpServletRequestBuilder request = get("/v1/users");
        for (int i = 0; i < params.length; i += 2) {
            request = request.param(params[i], params[i + 1]);
        }
        MvcResult result = as(admin, request);
        assertThat(status(result)).as(content(result)).isEqualTo(200);
        return body(result);
    }

    private static List<String> names(JsonNode page) {
        List<String> names = new ArrayList<>();
        page.get("rows").forEach(row -> names.add(row.get("name").asString()));
        return names;
    }

    /** The tag spelled in letters only, for a name (names allow no digits). */
    private String letterTag() {
        StringBuilder letters = new StringBuilder();
        for (char c : tag.toCharArray()) {
            letters.append(Character.isDigit(c) ? (char) ('g' + (c - '0')) : c);
        }
        return letters.toString();
    }

    // ---------------------------------------------------------------- search, filter, sort, pages

    @Test
    void list_matchesTheEmailAndTheName_caseInsensitively_andPages() throws Exception {
        seed("Anna", "anna", Roles.USER, true);
        seed("Bert", "bert", Roles.USER, false);
        seed("Carl", "carl", Roles.ADMIN, true);
        String name = "Q" + letterTag();
        seed(name, "someone", Roles.USER, true);

        JsonNode first = list("q", tag.toUpperCase(Locale.ROOT), "sort", "name,asc", "size", "2");
        JsonNode second = list("q", tag, "sort", "name,asc", "size", "2", "page", "1");

        assertThat(names(first)).containsExactly("Anna", "Bert");
        assertThat(first.get("totalRows").asLong()).isEqualTo(4);
        assertThat(first.get("page").asInt()).isZero();
        assertThat(first.get("size").asInt()).isEqualTo(2);
        assertThat(names(second)).containsExactly("Carl", name);
        assertThat(first.get("rows").get(0).propertyNames()).contains("protectedAccount", "deactivationReason")
            .doesNotContain("passwordHash", "resetTokenHash");
        // No email contains "q" + the tag: this can only match the name.
        assertThat(names(list("q", name.toLowerCase(Locale.ROOT)))).as("the name alone").containsExactly(name);
    }

    @Test
    void list_filtersByTheActiveFlag() throws Exception {
        seed("Anna", "anna", Roles.USER, true);
        seed("Bert", "bert", Roles.USER, false);

        assertThat(names(list("q", tag, "active", "false"))).containsExactly("Bert");
        assertThat(names(list("q", tag, "active", "true"))).containsExactly("Anna");
        assertThat(names(list("q", tag, "active", "", "sort", "name"))).containsExactly("Anna", "Bert");
    }

    /** "role" sorts through the join on tbl_roles; the id breaks the tie between equal roles. */
    @Test
    void list_sortsByTheRoleName() throws Exception {
        seed("Anna", "anna", Roles.USER, true);
        seed("Bert", "bert", Roles.USER, true);
        seed("Carl", "carl", Roles.ADMIN, true);

        assertThat(names(list("q", tag, "sort", "role,asc"))).containsExactly("Carl", "Anna", "Bert");
        assertThat(names(list("q", tag, "sort", "role,desc"))).containsExactly("Bert", "Anna", "Carl");
    }

    /** % and _ in the search text are characters to find, not LIKE wildcards; '!' is the escape itself. */
    @Test
    void list_treatsLikeWildcardsAsPlainCharacters() throws Exception {
        seed("Pia", "p_q", Roles.USER, true);
        seed("Pete", "pxq", Roles.USER, true);
        seed("Rita", "r%s", Roles.USER, true);
        seed("Rolf", "rzzs", Roles.USER, true);

        assertThat(names(list("q", "p_q." + tag))).containsExactly("Pia");
        assertThat(names(list("q", "r%s." + tag))).containsExactly("Rita");
        assertThat(names(list("q", "!" + tag))).isEmpty();
        assertThat(names(list("q", tag + "!"))).isEmpty();
        assertThat(list("q", tag).get("totalRows").asLong()).isEqualTo(4);
    }

    @Test
    void list_outsideTheLimits_is400() throws Exception {
        MvcResult tooBig = as(admin, get("/v1/users").param("size", "101"));
        MvcResult badSort = as(admin, get("/v1/users").param("sort", "passwordHash,asc"));

        assertThat(status(tooBig)).isEqualTo(400);
        assertThat(content(tooBig)).contains("\"errorCode\":\"VALIDATION_ERROR\"");
        assertThat(status(badSort)).isEqualTo(400);
    }

    // ---------------------------------------------------------------- create, update, lock, delete

    private static Map<String, Object> userRequest(String name, String email, String password, String role) {
        Map<String, Object> request = new HashMap<>();
        request.put("name", name);
        request.put("email", email);
        request.put("password", password);
        request.put("role", role);
        request.put("preferredLanguage", "en");
        request.put("active", true);
        request.put("deactivationReason", null);
        return request;
    }

    private MvcResult send(MockHttpServletRequestBuilder request, Object json) throws Exception {
        return as(admin, request.contentType(MediaType.APPLICATION_JSON).content(json(json)));
    }

    @Test
    void anAccount_isCreated_edited_locked_unlocked_andDeleted() throws Exception {
        String email = "dora." + tag + "@list.test";

        MvcResult created = send(post("/v1/users"), userRequest("Dora", email, "Secret123", Roles.USER));
        assertThat(status(created)).as(content(created)).isEqualTo(201);
        long id = body(created).get("id").asLong();
        assertThat(status(login(email, "Secret123"))).isEqualTo(200);

        MvcResult edited = send(put("/v1/users/" + id), userRequest("Dora", email, "", Roles.ADMIN));
        assertThat(status(edited)).as(content(edited)).isEqualTo(200);
        assertThat(body(edited).get("role").asString()).isEqualTo(Roles.ADMIN);
        MvcResult stillIn = login(email, "Secret123");
        assertThat(status(stillIn)).as("a blank password keeps the old one").isEqualTo(200);
        Cookie beforeTheLock = refreshCookie(stillIn);

        MvcResult locked = send(patch("/v1/users/" + id + "/active"), Map.of("reason", "SPAM"));
        assertThat(body(locked).get("active").asBoolean()).isFalse();
        assertThat(body(locked).get("deactivationReason").asString()).isEqualTo("SPAM");
        assertThat(status(login(email, "Secret123"))).as("an admin lock has no grace period").isEqualTo(401);

        MvcResult unlocked = as(admin, patch("/v1/users/" + id + "/active"));
        assertThat(body(unlocked).get("active").asBoolean()).isTrue();
        assertThat(body(unlocked).get("deactivationReason").isNull()).isTrue();
        assertThat(status(refresh(beforeTheLock))).as("lifting the lock revives no session from before it")
            .isEqualTo(401);

        assertThat(status(as(admin, delete("/v1/users/" + id)))).isEqualTo(204);
        MvcResult gone = as(admin, get("/v1/users/" + id));
        assertThat(status(gone)).isEqualTo(404);
        assertThat(content(gone)).contains("\"errorCode\":\"USER_NOT_FOUND\"");
        verify(authMailer).sendAccountDeletedByAdmin(any());
    }

    @Test
    void anEmailThatBelongsToAnotherAccount_is409() throws Exception {
        User anna = seed("Anna", "anna", Roles.USER, true);
        User bert = seed("Bert", "bert", Roles.USER, true);

        MvcResult result = send(put("/v1/users/" + bert.getId()),
            userRequest("Bert", anna.getEmail(), "", Roles.USER));

        assertThat(status(result)).isEqualTo(409);
        assertThat(content(result)).contains("\"errorCode\":\"EMAIL_ALREADY_EXISTS\"");
    }

    /**
     * A password set in the editor ends every session of the account it belongs to - a stolen account must not keep
     * its intruder's refresh token after an admin "fixed" it. When it is the editor's own password, that includes
     * the editor's session, so the answer carries a replacement; for anyone else's it must not touch the editor.
     */
    @Test
    void aPasswordSetInTheEditor_endsTheAccountsSessions_andOnlyTheEditorsOwnGetsAReplacement() throws Exception {
        User olga = seed("Olga", "olga", Roles.ADMIN, true);
        User anna = seed("Anna", "anna", Roles.USER, true);
        Cookie annasPhone = refreshCookie(login(anna.getEmail(), PASSWORD));
        Cookie olgasLaptop = refreshCookie(login(olga.getEmail(), PASSWORD));
        Cookie olgasPhone = refreshCookie(login(olga.getEmail(), PASSWORD));
        String asOlga = bearer(olga);

        MvcResult annas = as(asOlga, put("/v1/users/" + anna.getId()).contentType(MediaType.APPLICATION_JSON)
            .content(json(userRequest("Anna", anna.getEmail(), "Other-pass-5", Roles.USER))));

        assertThat(status(annas)).as(content(annas)).isEqualTo(200);
        assertThat(annas.getResponse().getHeader("Set-Cookie")).isNull();
        assertThat(status(refresh(annasPhone))).isEqualTo(401);
        assertThat(status(refresh(olgasLaptop))).as("someone else's password leaves the editor signed in")
            .isEqualTo(200);

        MvcResult own = as(asOlga, put("/v1/users/" + olga.getId()).contentType(MediaType.APPLICATION_JSON)
            .content(json(userRequest("Olga", olga.getEmail(), "Own-new-pass-6", Roles.ADMIN))));

        assertThat(status(own)).as(content(own)).isEqualTo(200);
        Cookie replacement = refreshCookie(own);
        assertThat(status(refresh(olgasLaptop))).isEqualTo(401);
        assertThat(status(refresh(olgasPhone))).isEqualTo(401);
        assertThat(status(refresh(replacement))).isEqualTo(200);
    }

    /** Checked with a second admin: the root acting on itself would be refused as "self" first. */
    @Test
    void theRootAccount_refusesEveryDestructiveAdminPath() throws Exception {
        String otherAdmin = bearer(seed("Olga", "olga", Roles.ADMIN, true));
        User root = root();

        MvcResult update = as(otherAdmin, put("/v1/users/" + root.getId()).contentType(MediaType.APPLICATION_JSON)
            .content(json(userRequest("Root", ROOT_EMAIL, "", Roles.USER))));
        MvcResult toggle = as(otherAdmin, patch("/v1/users/" + root.getId() + "/active"));
        MvcResult remove = as(otherAdmin, delete("/v1/users/" + root.getId()));

        for (MvcResult result : List.of(update, toggle, remove)) {
            assertThat(status(result)).isEqualTo(403);
            assertThat(content(result)).contains("\"errorCode\":\"ROOT_USER_PROTECTED\"");
        }
        assertThat(root().isActive()).isTrue();
        assertThat(root().getRole().getName()).isEqualTo(Roles.ADMIN);
    }

    @Test
    void anAdmin_cannotLockOrDeleteThemself() throws Exception {
        User olga = seed("Olga", "olga", Roles.ADMIN, true);

        MvcResult lock = as(bearer(olga), patch("/v1/users/" + olga.getId() + "/active"));
        MvcResult remove = as(bearer(olga), delete("/v1/users/" + olga.getId()));

        assertThat(content(lock)).contains("\"errorCode\":\"CANNOT_DEACTIVATE_SELF\"");
        assertThat(content(remove)).contains("\"errorCode\":\"CANNOT_DELETE_SELF\"");
        assertThat(reload(olga).isActive()).isTrue();
    }
}
