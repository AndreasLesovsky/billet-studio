package app.billetstudio.shared.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Every failure leaves as the same three-field ApiError with a code from the contract - never Spring's default
 * problem body, never an exception message. Runs against a probe controller, so each error can be provoked on
 * purpose. Unknown route, wrong method and malformed JSON through the whole stack are SecurityRoutesIT; the domain
 * exceptions' codes are ApiErrorContractTest.
 */
class GlobalExceptionHandlerTest {

    record Body(@NotBlank String name) {
    }

    @RestController
    @RequestMapping("/probe")
    static class ProbeController {

        @PostMapping("/json")
        ResponseEntity<Void> json(@Valid @RequestBody Body body) {
            return ResponseEntity.noContent().build();
        }

        @PostMapping("/upload")
        ResponseEntity<Void> upload(@RequestParam("image") MultipartFile image) {
            return ResponseEntity.noContent().build();
        }

        @GetMapping("/fail/{kind}")
        void fail(@PathVariable("kind") String kind) {
            throw switch (kind) {
            case "integrity" -> new DataIntegrityViolationException("Duplicate entry 'x' for key 'uk_users_email'");
            case "lock" -> new ObjectOptimisticLockingFailureException(Body.class, 1L);
            default -> new IllegalStateException("internal detail that must never reach a client");
            };
        }
    }

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
        .setControllerAdvice(handler)
        .build();
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    /** Status, errorCode, and nothing but the contract's three fields. */
    private MvcResult expectApiError(RequestBuilder request, int status, String errorCode) throws Exception {
        MvcResult result = mockMvc.perform(request)
            .andExpect(status().is(status))
            .andExpect(jsonPath("$.errorCode").value(errorCode))
            .andExpect(jsonPath("$.status").value(status))
            .andReturn();
        JsonNode body = jsonMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
        assertThat(body.propertyNames()).containsExactlyInAnyOrder("errorCode", "status", "timestamp");
        assertThat(body.get("timestamp").isString()).as("timestamp is an ISO instant string").isTrue();
        return result;
    }

    static Stream<Arguments> clientErrors() {
        return Stream.of(
            Arguments.of("a failed bean validation", post("/probe/json").contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\": \"  \"}"), "VALIDATION_ERROR"),
            // DEVIATION from Spring's 415: the contract has no code for it, so it shares MALFORMED_REQUEST's 400.
            Arguments.of("a wrong content type", post("/probe/json").contentType(MediaType.TEXT_PLAIN)
                .content("name=x"), "MALFORMED_REQUEST"),
            // An avatar sent under another part name.
            Arguments.of("a missing multipart part", multipart("/probe/upload"), "VALIDATION_ERROR"));
    }

    @ParameterizedTest(name = "{0} -> 400 {2}")
    @MethodSource("clientErrors")
    void aClientError_is400_withItsContractCode(String description, RequestBuilder request, String errorCode)
        throws Exception {
        expectApiError(request, 400, errorCode);
    }

    @Test
    void an_upload_over_the_multipart_limit_is_413_file_too_large() throws Exception {
        ResponseEntity<Object> response = handler.handleException(new MaxUploadSizeExceededException(21L << 20),
            new ServletWebRequest(new MockHttpServletRequest(), new MockHttpServletResponse()));

        assertThat(response.getStatusCode().value()).isEqualTo(413);
        assertThat(response.getBody()).isInstanceOfSatisfying(ApiError.class,
            error -> assertThat(error.errorCode()).isEqualTo("FILE_TOO_LARGE"));
    }

    @ParameterizedTest
    @CsvSource({
        "integrity, 409, DATA_INTEGRITY_ERROR",
        "lock, 409, CONCURRENT_MODIFICATION",
        "anything-else, 500, INTERNAL_SERVER_ERROR"
    })
    void aDataOrUnexpectedError_mapsToItsContractCode(String kind, int status, String errorCode) throws Exception {
        expectApiError(get("/probe/fail/" + kind), status, errorCode);
    }

    @Test
    void no_exception_message_reaches_the_client() throws Exception {
        MvcResult unexpected = mockMvc.perform(get("/probe/fail/boom")).andReturn();
        MvcResult integrity = mockMvc.perform(get("/probe/fail/integrity")).andReturn();

        assertThat(unexpected.getResponse().getContentAsString()).doesNotContain("internal detail");
        assertThat(integrity.getResponse().getContentAsString()).doesNotContain("uk_users_email");
    }
}
