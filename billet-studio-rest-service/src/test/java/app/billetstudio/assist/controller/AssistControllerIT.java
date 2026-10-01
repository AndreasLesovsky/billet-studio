package app.billetstudio.assist.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import app.billetstudio.support.WebITBase;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;

import tools.jackson.databind.JsonNode;

/**
 * The assistant switched off, as in every test context (MariaDbITBase): the status says so, a question is answered
 * with the contract's 503, and a malformed one is still a 400 - the request is checked before the switch.
 */
@Testcontainers(disabledWithoutDocker = true)
class AssistControllerIT extends WebITBase {

    private MvcResult ask(String body) throws Exception {
        return mockMvc.perform(post("/v1/assist").contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }

    @Test
    void switched_off_the_status_says_so_and_a_question_gets_assist_unavailable() throws Exception {
        MvcResult status = mockMvc.perform(get("/v1/assist/status")).andReturn();
        assertThat(json(status).get("status").asString()).isEqualTo("DISABLED");
        assertThat(status.getResponse().getHeader("Cache-Control")).contains("no-store");

        MvcResult answer = ask("{\"conversation\":[{\"role\":\"user\",\"content\":\"Eine Geburtstagskarte\"}]}");
        assertThat(answer.getResponse().getStatus()).isEqualTo(503);
        assertThat(json(answer).get("errorCode").asString()).isEqualTo("ASSIST_UNAVAILABLE");
    }

    @Test
    void a_message_over_the_limit_is_a_validation_error() throws Exception {
        String tooLong = "a".repeat(301);

        MvcResult answer = ask("{\"conversation\":[{\"role\":\"user\",\"content\":\"" + tooLong + "\"}]}");

        assertThat(answer.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(answer).get("errorCode").asString()).isEqualTo("VALIDATION_ERROR");
    }
}
