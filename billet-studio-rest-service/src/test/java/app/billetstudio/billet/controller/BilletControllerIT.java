package app.billetstudio.billet.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.stream.Stream;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.billet.document.BilletDocumentCodec;
import app.billetstudio.billet.dto.PublishResponse;
import app.billetstudio.billet.entity.Billet;
import app.billetstudio.billet.repository.BilletRepository;
import app.billetstudio.billet.service.BilletService;
import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.core.json.JsonWriteFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * /v1/billets and the public share link against the real schema and model seed, driven by the reference document
 * docs/fixtures/muttertag.billet.json. The billet cap is the low one MariaDbITBase pins.
 */
@Testcontainers(disabledWithoutDocker = true)
class BilletControllerIT extends WebITBase {

    private static final Path FIXTURE = Path.of("..", "docs", "fixtures", "muttertag.billet.json");
    /** The fixture's model, and a second active one. */
    private static final String FIXTURE_MODEL = "flower-bouquet";
    private static final String OTHER_MODEL = "gift-box";

    /** Numbers by value (the fixture writes 1 where the stored document has 1.0); keys and everything else exactly. */
    private static final Comparator<JsonNode> NUMBERS_BY_VALUE = (a, b) -> {
        if (a.isNumber() && b.isNumber()) {
            return a.decimalValue().compareTo(b.decimalValue());
        }
        return a.equals(b) ? 0 : 1;
    };

    @Autowired
    private BilletRepository billetRepository;
    @Autowired
    private BilletService billetService;
    @Autowired
    private BilletDocumentCodec codec;
    @Autowired
    private PlatformTransactionManager transactionManager;

    // ---------------------------------------------------------------- helpers

    private ObjectNode fixture() {
        try {
            return (ObjectNode) jsonMapper.readTree(Files.readString(FIXTURE, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private ObjectNode titled(String title) {
        ObjectNode document = fixture();
        document.put("title", title);
        return document;
    }

    private static ObjectNode node(JsonNode document, String pointer) {
        return (ObjectNode) document.at(pointer);
    }

    private static void assertSameDocument(JsonNode actual, JsonNode expected) {
        assertThat(actual.equals(NUMBERS_BY_VALUE, expected))
            .withFailMessage("expected the document%n%s%nbut got%n%s", expected, actual)
            .isTrue();
    }

    private User user(String prefix, String language) {
        User user = createUser("Anna", uniqueEmail(prefix), "Irrelevant-1", Roles.USER);
        if (language.equals(user.getPreferredLanguage())) {
            return user;
        }
        user.setPreferredLanguage(language);
        return userRepository.save(user);
    }

    private User user(String prefix) {
        return user(prefix, "de");
    }

    private MvcResult send(User user, AbstractMockHttpServletRequestBuilder<?> request, Object body)
        throws Exception {
        if (user != null) {
            request.header(HttpHeaders.AUTHORIZATION, bearer(user));
        }
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON);
            // ASCII only: a browser's JSON.stringify sends an unpaired surrogate as an escape. Written raw, the UTF-8
            // encoding of the request body would already turn it into '?' before the server sees it.
            request.content(jsonMapper.writer().with(JsonWriteFeature.ESCAPE_NON_ASCII).writeValueAsString(body));
        }
        return mockMvc.perform(request).andReturn();
    }

    private MvcResult create(User user, JsonNode document) throws Exception {
        return send(user, post("/v1/billets"), Map.of("document", document));
    }

    /** The detail of a billet that must be created. */
    private JsonNode created(User user, JsonNode document) throws Exception {
        MvcResult result = create(user, document);
        assertThat(status(result)).as("create: %s", content(result)).isEqualTo(201);
        return body(result);
    }

    private MvcResult save(User user, long id, long version, JsonNode document) throws Exception {
        return send(user, put("/v1/billets/{id}", id), Map.of("version", version, "document", document));
    }

    private MvcResult publish(User user, long id, long version) throws Exception {
        return send(user, post("/v1/billets/{id}/publish", id), Map.of("version", version));
    }

    private MvcResult unpublish(User user, long id) throws Exception {
        return send(user, post("/v1/billets/{id}/unpublish", id), null);
    }

    private MvcResult duplicate(User user, long id) throws Exception {
        return send(user, post("/v1/billets/{id}/duplicate", id), null);
    }

    private MvcResult detail(User user, long id) throws Exception {
        return send(user, get("/v1/billets/{id}", id), null);
    }

    private MvcResult importDocuments(User user, JsonNode... documents) throws Exception {
        return send(user, post("/v1/billets/import"), Map.of("documents", List.of(documents)));
    }

    private MvcResult publicBillet(String shareToken) throws Exception {
        return send(null, get("/v1/public/billets/{shareToken}", shareToken), null);
    }

    private JsonNode list(User user) throws Exception {
        MvcResult result = send(user, get("/v1/billets"), null);
        assertThat(status(result)).isEqualTo(200);
        return body(result);
    }

    private JsonNode summaryOf(User user, long id) throws Exception {
        return list(user).values().stream().filter(row -> row.get("id").asLong() == id).findFirst().orElseThrow();
    }

    private static List<String> titles(JsonNode summaries) {
        return summaries.values().stream().map(row -> row.get("title").asString()).toList();
    }

    private void assertError(MvcResult result, int status, String errorCode) throws Exception {
        assertThat(status(result)).as(content(result)).isEqualTo(status);
        assertThat(body(result).get("errorCode").asString()).isEqualTo(errorCode);
    }

    /** An ApiError without its timestamp, so two answers can be compared whole. */
    private JsonNode errorBody(MvcResult result) throws Exception {
        ObjectNode error = (ObjectNode) body(result);
        error.remove("timestamp");
        return error;
    }

    private JsonNode reversedKeyOrder(JsonNode node) {
        if (node.isObject()) {
            List<Entry<String, JsonNode>> properties = new ArrayList<>(node.properties());
            Collections.reverse(properties);
            ObjectNode copy = jsonMapper.createObjectNode();
            properties.forEach(property -> copy.set(property.getKey(), reversedKeyOrder(property.getValue())));
            return copy;
        }
        if (node.isArray()) {
            ArrayNode copy = jsonMapper.createArrayNode();
            node.values().forEach(value -> copy.add(reversedKeyOrder(value)));
            return copy;
        }
        return node;
    }

    // ---------------------------------------------------------------- the document

    /**
     * The reference document survives create and read unchanged, unknown fields - top-level and nested - are not
     * stored, and the same content sent again in another key order normalizes to the same JSON: the autosave writes
     * nothing and the published billet has no unpublished changes.
     */
    @Test
    void theReferenceDocument_roundTrips_withoutUnknownFields_andNormalizesToTheSameJson() throws Exception {
        User anna = user("roundtrip");
        ObjectNode sent = fixture();
        sent.put("legacyField", "dropped");
        node(sent, "/palette/light").put("glow", "#ffffff");
        node(sent, "/blocks/0").put("html", "<b>dropped</b>");

        JsonNode billet = created(anna, sent);
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();

        assertSameDocument(billet.get("document"), fixture());
        String stored = jdbc().queryForObject("SELECT document FROM tbl_billets WHERE id = ?", String.class, id);
        assertSameDocument(jsonMapper.readTree(stored), fixture());
        JsonNode read = body(detail(anna, id));
        assertSameDocument(read.get("document"), fixture());
        assertThat(read.at("/model/slug").asString()).isEqualTo(FIXTURE_MODEL);

        assertThat(status(publish(anna, id, version))).isEqualTo(200);
        MvcResult resaved = save(anna, id, version, reversedKeyOrder(sent));

        assertThat(status(resaved)).isEqualTo(200);
        assertThat(body(resaved).get("hasUnpublishedChanges").asBoolean()).isFalse();
        assertThat(body(resaved).get("version").asLong()).as("an unchanged document writes nothing").isEqualTo(version);
    }

    private static Arguments rule(String rule, Consumer<ObjectNode> breakIt, String errorCode) {
        return Arguments.of(rule, breakIt, errorCode);
    }

    /** One row per rule class; the individual limits are the records' annotations. */
    static Stream<Arguments> documentsBreakingARule() {
        return Stream.of(
            rule("a colour that is not #rrggbb", doc -> node(doc, "/palette/dark").put("ink", "#f0e8e"),
                "VALIDATION_ERROR"),
            rule("a spacing step past the scale", doc -> node(doc, "/spacing").put("gutter", 19), "VALIDATION_ERROR"),
            rule("a heading over its 160-character limit",
                doc -> node(doc, "/blocks/0").put("type", "heading").put("text", "x".repeat(161)), "VALIDATION_ERROR"),
            rule("two blocks with one id", doc -> node(doc, "/blocks/1").put("id", "b1"), "VALIDATION_ERROR"),
            rule("an icon on a paragraph", doc -> node(doc, "/blocks/0").put("icon", "🌸"),
                "VALIDATION_ERROR"),
            rule("a missing field", doc -> node(doc, "/hero").remove("sub"), "VALIDATION_ERROR"),
            rule("half an emoji, its other half cut off",
                doc -> node(doc, "/blocks/0").put("text", "Mama " + (char) 0xD83C), "VALIDATION_ERROR"),
            rule("a C0 control character in a text field", doc -> node(doc, "/hero").put("sub", "von\u0000Andreas"),
                "VALIDATION_ERROR"),
            rule("a tab - the one control character a text field allows is \\n",
                doc -> node(doc, "/blocks/0").put("text", "Mama\tPapa"), "VALIDATION_ERROR"),
            rule("DEL in a text field", doc -> node(doc, "/signature").put("name", "Andreas\u007F"),
                "VALIDATION_ERROR"),
            rule("nesting past the parser's depth limit, in a field the document drops",
                BilletControllerIT::nestDeeply, "VALIDATION_ERROR"),
            rule("schemaVersion 2, although a field is missing too", doc -> doc.put("schemaVersion", 2).remove("theme"),
                "UNSUPPORTED_SCHEMA_VERSION"),
            rule("an enabled scene with an unknown model", doc -> node(doc, "/scene").put("modelSlug", "no-such-model"),
                "UNKNOWN_MODEL"),
            rule("every field within its limit, the whole over max-document-bytes", BilletControllerIT::inflate,
                "VALIDATION_ERROR"));
    }

    /**
     * JSON escaping takes a document within every field limit past the byte cap: a quote is one character of text but
     * a two-byte escape. 20 such paragraphs are about 80 KB - over the 64 KiB document cap MariaDbITBase pins, under
     * the request body cap, so the codec's check is the one that answers.
     */
    private static void inflate(ObjectNode document) {
        ArrayNode blocks = (ArrayNode) document.get("blocks");
        ObjectNode paragraph = (ObjectNode) blocks.get(0);
        blocks.removeAll();
        for (int i = 0; i < 20; i++) {
            blocks.add(paragraph.deepCopy().put("id", "p" + i).put("text", "\"".repeat(2000)));
        }
    }

    /** Dropped with the unknown field, were it not for JacksonConfig's nesting limit. */
    private static void nestDeeply(ObjectNode document) {
        ArrayNode nested = document.putArray("legacyField");
        for (int i = 0; i < 40; i++) {
            nested = nested.addArray();
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("documentsBreakingARule")
    void aDocumentBreakingARule_isRefusedWithItsContractCode(String rule, Consumer<ObjectNode> breakIt,
        String errorCode) throws Exception {
        ObjectNode document = fixture();
        breakIt.accept(document);

        assertError(create(user("invalid"), document), 400, errorCode);
    }

    /**
     * A body far over the cap never reaches a full parse: it is whitespace in unterminated JSON, which a parse would
     * answer with MALFORMED_REQUEST. MockMvc always declares the length; a chunked body is ServletContainerTest's.
     */
    @Test
    void aBodyFarOverTheCap_isRefusedBeforeItIsParsed() throws Exception {
        User anna = user("bodycap");
        byte[] body = ("{\"document\":" + " ".repeat(16 * MAX_DOCUMENT_BYTES)).getBytes(StandardCharsets.UTF_8);

        MvcResult result = mockMvc.perform(post("/v1/billets")
            .header(HttpHeaders.AUTHORIZATION, bearer(anna))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
            .andReturn();

        assertError(result, 400, "VALIDATION_ERROR");
    }

    // ---------------------------------------------------------------- ownership and versions

    @ParameterizedTest(name = "{0} /v1/billets/'{id}'{1}")
    @CsvSource({
        "GET,    ''",
        "PUT,    ''",
        "DELETE, ''",
        "POST,   /duplicate",
        "POST,   /publish",
        "POST,   /unpublish"
    })
    void anotherUsersBillet_isNotFound_andStaysUntouched(String method, String action) throws Exception {
        User anna = user("owner");
        User bob = user("intruder");
        JsonNode billet = created(anna, fixture());
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();
        Object body = switch (method + action) {
        case "PUT" -> Map.of("version", version, "document", titled("Taken over"));
        case "POST/publish" -> Map.of("version", version);
        default -> null;
        };

        MvcResult result = send(bob,
            MockMvcRequestBuilders.request(HttpMethod.valueOf(method), "/v1/billets/" + id + action), body);

        assertError(result, 404, "BILLET_NOT_FOUND");
        JsonNode untouched = body(detail(anna, id));
        assertThat(untouched.get("version").asLong()).isEqualTo(version);
        assertThat(untouched.at("/document/title").asString()).isEqualTo(billet.at("/document/title").asString());
        assertThat(untouched.get("published").asBoolean()).isFalse();
        assertThat(list(anna).size()).isEqualTo(1);
        assertThat(list(bob).size()).isZero();
    }

    /** Another tab saved in between: neither the older autosave nor a publish of the older version goes through. */
    @Test
    void aStaleVersion_isRefusedOnSaveAndOnPublish() throws Exception {
        User anna = user("stale");
        long id = created(anna, fixture()).get("id").asLong();
        long seen = body(detail(anna, id)).get("version").asLong();

        MvcResult secondTab = save(anna, id, seen, titled("Second tab"));
        assertThat(status(secondTab)).isEqualTo(200);
        assertThat(body(secondTab).get("version").asLong()).isNotEqualTo(seen);

        assertError(save(anna, id, seen, titled("First tab")), 409, "BILLET_MODIFIED_ELSEWHERE");
        assertError(publish(anna, id, seen), 409, "BILLET_MODIFIED_ELSEWHERE");

        JsonNode current = body(detail(anna, id));
        assertThat(current.at("/document/title").asString()).isEqualTo("Second tab");
        assertThat(current.get("published").asBoolean()).isFalse();
    }

    /**
     * An autosave that read the row before a publish committed must not write the old publishing state back.
     * Publishing keeps the draft version, so that autosave passes its version check; @DynamicUpdate (the autosave
     * writes the draft columns only) is what keeps the publish.
     */
    @Test
    void anAutosaveThatReadTheRowBeforeAPublish_leavesThePublishInPlace() throws Exception {
        User anna = user("race");
        JsonNode billet = created(anna, fixture());
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();

        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            Billet autosave = billetRepository.findById(id).orElseThrow();
            // Its own thread, so its own transaction, committed while this one holds the unpublished row.
            CompletableFuture.runAsync(() -> billetService.publish(anna, id, version)).join();
            autosave.setDocument(codec.encode(codec.decode(autosave.getDocument()).withTitle("Autosaved")));
            autosave.setTitle("Autosaved");
            billetRepository.saveAndFlush(autosave);
        });

        JsonNode after = body(detail(anna, id));
        assertThat(after.at("/document/title").asString()).isEqualTo("Autosaved");
        assertThat(after.get("published").asBoolean()).isTrue();
        assertThat(after.get("shareToken").isNull()).isFalse();
        assertThat(after.get("hasUnpublishedChanges").asBoolean()).isTrue();
    }

    /**
     * Two first publishes at once (a double click, two tabs, a retry) hand out one token: the second waits for the
     * first to commit and reuses its token. Had it read the row before that commit, it would mint a token of its own
     * and overwrite the first one, whose link would never work.
     */
    @Test
    void twoFirstPublishesAtOnce_handOutOneToken() throws Exception {
        User anna = user("publishrace");
        JsonNode billet = created(anna, fixture());
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();
        AtomicReference<CompletableFuture<PublishResponse>> second = new AtomicReference<>();

        String first = new TransactionTemplate(transactionManager).execute(tx -> {
            String token = billetService.publish(anna, id, version).shareToken();
            second.set(CompletableFuture.supplyAsync(() -> billetService.publish(anna, id, version)));
            awaitAnotherConnectionWaitingOnARowOf("tbl_billets");
            return token;
        });

        assertThat(second.get().join().shareToken()).isEqualTo(first);
        assertThat(jdbc().queryForObject("SELECT share_token FROM tbl_billets WHERE id = ?", String.class, id))
            .isEqualTo(first);
    }

    /**
     * Returns once another connection runs a locking statement on the table (SELECT ... FOR UPDATE or UPDATE), which -
     * while the caller's transaction holds the row - means it is waiting for that transaction. PROCESSLIST shows the
     * connections of the same database user without extra privileges.
     */
    private void awaitAnotherConnectionWaitingOnARowOf(String table) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Long waiting = jdbc().queryForObject("SELECT COUNT(*) FROM information_schema.PROCESSLIST "
                + "WHERE ID <> CONNECTION_ID() AND INFO LIKE ? AND (INFO LIKE 'update%' OR INFO LIKE '%for update%')",
                Long.class, "%" + table + "%");
            if (waiting != null && waiting > 0) {
                return;
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        throw new AssertionError("No other connection started a locking statement on " + table);
    }

    // ---------------------------------------------------------------- publish and the public link

    /**
     * The link serves the snapshot, never the draft: autosaves after a publish change neither the text nor the model a
     * recipient sees. The editor learns about them through hasUnpublishedChanges - in the list too, where the database
     * compares and a letter-case change still counts although the column collation calls it equal.
     */
    @Test
    void thePublicLinkServesTheSnapshot_untilTheDraftIsRepublished() throws Exception {
        User anna = user("publish");
        JsonNode billet = created(anna, fixture());
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();

        MvcResult published = publish(anna, id, version);
        assertThat(status(published)).isEqualTo(200);
        String token = body(published).get("shareToken").asString();
        assertThat(token).matches("[A-Za-z0-9_-]{22}");
        assertThat(body(published).get("version").asLong()).as("the editor keeps its version").isEqualTo(version);

        MvcResult shared = publicBillet(token);
        assertThat(status(shared)).isEqualTo(200);
        assertThat(shared.getResponse().getHeader("X-Robots-Tag")).isEqualTo("noindex");
        assertThat(shared.getResponse().getHeader(HttpHeaders.CACHE_CONTROL)).contains("no-store");
        assertSameDocument(body(shared).get("document"), fixture());
        assertThat(body(shared).at("/model/slug").asString()).isEqualTo(FIXTURE_MODEL);

        ObjectNode lowerCase = fixture();
        node(lowerCase, "/hero").put("titleLine2", "mama");
        MvcResult caseOnly = save(anna, id, version, lowerCase);
        assertThat(status(caseOnly)).isEqualTo(200);
        assertThat(body(caseOnly).get("hasUnpublishedChanges").asBoolean()).isTrue();
        assertThat(summaryOf(anna, id).get("hasUnpublishedChanges").asBoolean()).isTrue();

        ObjectNode otherModel = lowerCase.deepCopy();
        node(otherModel, "/scene").put("modelSlug", OTHER_MODEL);
        MvcResult modelChanged = save(anna, id, body(caseOnly).get("version").asLong(), otherModel);
        assertThat(status(modelChanged)).isEqualTo(200);

        JsonNode stillShared = body(publicBillet(token));
        assertThat(stillShared.at("/document/hero/titleLine2").asString()).isEqualTo("Mama");
        assertThat(stillShared.at("/model/slug").asString()).as("the snapshot's model").isEqualTo(FIXTURE_MODEL);

        MvcResult republished = publish(anna, id, body(modelChanged).get("version").asLong());
        assertThat(body(republished).get("shareToken").asString()).isEqualTo(token);
        JsonNode updated = body(publicBillet(token));
        assertSameDocument(updated.get("document"), otherModel);
        assertThat(updated.at("/model/slug").asString()).isEqualTo(OTHER_MODEL);
        assertThat(summaryOf(anna, id).get("hasUnpublishedChanges").asBoolean()).isFalse();
    }

    /**
     * Unpublishing takes the page offline at once and keeps the token, so a republish restores the same link. Whoever
     * holds a link cannot tell an unpublished billet from an unknown or malformed token, or from an owner whose account
     * is no longer active; a reactivated owner's links work again.
     */
    @Test
    void anUnpublishedLink_answersLikeAnUnknownOne_andARepublishRestoresIt() throws Exception {
        User anna = user("unpublish");
        JsonNode billet = created(anna, fixture());
        long id = billet.get("id").asLong();
        long version = billet.get("version").asLong();
        String token = body(publish(anna, id, version)).get("shareToken").asString();

        assertThat(status(unpublish(anna, id))).isEqualTo(204);

        MvcResult gone = publicBillet(token);
        assertError(gone, 404, "BILLET_NOT_FOUND");
        assertThat(gone.getResponse().getHeader("X-Robots-Tag")).isEqualTo("noindex");
        assertThat(errorBody(publicBillet("AAAAAAAAAAAAAAAAAAAAAA"))).isEqualTo(errorBody(gone));
        assertThat(errorBody(publicBillet("not-a-share-token"))).isEqualTo(errorBody(gone));
        JsonNode unpublished = body(detail(anna, id));
        assertThat(unpublished.get("published").asBoolean()).isFalse();
        assertThat(unpublished.get("shareToken").asString()).isEqualTo(token);

        MvcResult republished = publish(anna, id, version);
        assertThat(status(republished)).as("unpublishing keeps the version too").isEqualTo(200);
        assertThat(body(republished).get("shareToken").asString()).isEqualTo(token);
        assertThat(status(publicBillet(token))).isEqualTo(200);

        anna.setActive(false);
        userRepository.save(anna);
        assertThat(errorBody(publicBillet(token))).isEqualTo(errorBody(gone));

        anna.setActive(true);
        userRepository.save(anna);
        assertThat(status(publicBillet(token))).isEqualTo(200);
    }

    // ---------------------------------------------------------------- duplicate, import, the cap

    /**
     * A copy is a new, unpublished draft with the same content. Its title gets the suffix in the owner's language and
     * still fits the 120-character limit, cut without splitting an emoji.
     */
    @Test
    void duplicate_isAnUnpublishedCopy_titledInTheOwnersLanguage() throws Exception {
        User anna = user("duplicate");
        // 120 UTF-16 units, the flower being a surrogate pair; " (Kopie)" leaves room for 112, which ends inside it.
        ObjectNode source = titled("a".repeat(111) + "🌸" + "b".repeat(7));
        JsonNode billet = created(anna, source);
        long id = billet.get("id").asLong();
        assertThat(status(publish(anna, id, billet.get("version").asLong()))).isEqualTo(200);

        MvcResult copied = duplicate(anna, id);

        assertThat(status(copied)).isEqualTo(201);
        JsonNode copy = body(copied);
        assertThat(copy.get("id").asLong()).isNotEqualTo(id);
        assertThat(copy.get("published").asBoolean()).isFalse();
        assertThat(copy.get("shareToken").isNull()).isTrue();
        assertSameDocument(copy.get("document"), source.put("title", "a".repeat(111) + " (Kopie)"));

        User john = user("duplicate", "en");
        long johnsBillet = created(john, fixture()).get("id").asLong();
        assertThat(body(duplicate(john, johnsBillet)).at("/document/title").asString())
            .isEqualTo(fixture().get("title").asString() + " (copy)");
    }

    /** The last document is the broken one, so storing as it goes would already have written the others. */
    @Test
    void import_storesAllOrNothing_andAnswersInRequestOrder() throws Exception {
        User anna = user("import");
        ObjectNode badSpacing = titled("Drei");
        node(badSpacing, "/spacing").put("gutter", 19);
        ObjectNode unknownModel = titled("Drei");
        node(unknownModel, "/scene").put("modelSlug", "no-such-model");

        assertError(importDocuments(anna, titled("Eins"), titled("Zwei"), badSpacing), 400, "VALIDATION_ERROR");
        assertError(importDocuments(anna, titled("Eins"), titled("Zwei"), unknownModel), 400, "UNKNOWN_MODEL");
        assertThat(list(anna).size()).isZero();

        MvcResult imported = importDocuments(anna, titled("Eins"), titled("Zwei"), titled("Drei"));

        assertThat(status(imported)).isEqualTo(201);
        assertThat(titles(body(imported).get("billets"))).containsExactly("Eins", "Zwei", "Drei");
        assertThat(list(anna).size()).isEqualTo(3);
    }

    /**
     * app.billet.max-per-user counts every way in: an import that would pass it is refused whole although part of it
     * would fit, a create or a duplicate at the cap is refused, and a delete frees a place.
     */
    @Test
    void theBilletCap_countsCreatesImportsAndDuplicates() throws Exception {
        User anna = user("cap");
        long first = created(anna, titled("Nr 1")).get("id").asLong();
        for (int i = 2; i < MAX_BILLETS_PER_USER; i++) {
            created(anna, titled("Nr " + i));
        }

        assertError(importDocuments(anna, titled("Import 1"), titled("Import 2")), 409, "BILLET_LIMIT_REACHED");
        assertThat(list(anna).size()).isEqualTo(MAX_BILLETS_PER_USER - 1);

        assertThat(status(create(anna, titled("The last one")))).isEqualTo(201);
        assertError(create(anna, titled("One too many")), 409, "BILLET_LIMIT_REACHED");
        assertError(duplicate(anna, first), 409, "BILLET_LIMIT_REACHED");
        assertThat(list(anna).size()).isEqualTo(MAX_BILLETS_PER_USER);

        assertThat(status(send(anna, MockMvcRequestBuilders.delete("/v1/billets/{id}", first), null)))
            .isEqualTo(204);
        assertThat(status(create(anna, titled("After a delete")))).isEqualTo(201);
    }
}
