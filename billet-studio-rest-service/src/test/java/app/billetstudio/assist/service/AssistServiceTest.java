package app.billetstudio.assist.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistRequest;
import app.billetstudio.assist.dto.AssistStatus;
import app.billetstudio.assist.dto.AssistTurnDto;
import app.billetstudio.assist.exception.AssistUnavailableException;
import app.billetstudio.assist.questionnaire.Questionnaire;
import app.billetstudio.assist.questionnaire.QuestionnaireClient;
import app.billetstudio.auth.exception.RateLimitExceededException;
import app.billetstudio.catalog.service.ModelCatalogService;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

/** The switch and the single slot: what the service decides before and around the model. */
class AssistServiceTest {

    private static final AssistRequest HELLO = new AssistRequest(List.of(new AssistTurnDto("user", "Hallo", null)));

    private final QuestionnaireClient client = mock(QuestionnaireClient.class);
    private final ModelCatalogService catalog = mock(ModelCatalogService.class);
    private final BilletQuestionnaire questionnaire = new BilletQuestionnaire(JsonMapper.builder().build());

    private AssistService service(boolean enabled, Duration queueWait) {
        return new AssistService(client, questionnaire, catalog, enabled, false, queueWait);
    }

    @Test
    void switched_off_it_asks_nobody() {
        AssistService off = service(false, Duration.ofSeconds(1));

        assertThat(off.status()).isEqualTo(AssistStatus.DISABLED);
        assertThatThrownBy(() -> off.ask(HELLO)).isInstanceOf(AssistUnavailableException.class);
        off.warmUp();
        verifyNoInteractions(client);
    }

    @Test
    void questions_wait_for_the_model_load_together_and_queue_only_for_answering() throws Exception {
        CountDownLatch loaded = new CountDownLatch(1);
        when(catalog.listActive()).thenReturn(List.of());
        doAnswer(invocation -> loaded.await(5, TimeUnit.SECONDS)).when(client).awaitReady();
        when(client.answer(any(Questionnaire.class), anyString())).thenReturn(Map.of("template", "KEEP",
            "theme", "KEEP", "particles", "KEEP", "divider", "KEEP", "colorMode", "KEEP", "lang", "KEEP",
            "model", "KEEP"));
        AssistService service = service(true, Duration.ofMillis(200));
        List<Object> outcomes = new CopyOnWriteArrayList<>();

        List<Thread> askers = List.of(1, 2).stream().map(i -> Thread.ofVirtual().start(() -> {
            try {
                outcomes.add(service.ask(HELLO));
            } catch (RuntimeException e) {
                outcomes.add(e);
            }
        })).toList();
        Thread.sleep(500);
        loaded.countDown();
        for (Thread asker : askers) {
            asker.join(Duration.ofSeconds(5));
        }

        assertThat(outcomes).hasSize(2).allMatch(outcome -> outcome instanceof AssistReply);
    }

    @Test
    void a_question_that_finds_the_model_busy_past_the_wait_is_told_to_try_again() throws Exception {
        CountDownLatch busy = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(catalog.listActive()).thenReturn(List.of());
        when(client.answer(any(Questionnaire.class), anyString())).thenAnswer(invocation -> {
            busy.countDown();
            release.await(5, TimeUnit.SECONDS);
            throw new AssistUnavailableException("done");
        });
        AssistService service = service(true, Duration.ofMillis(200));

        Thread first = Thread.ofVirtual().start(() -> {
            try {
                service.ask(HELLO);
            } catch (AssistUnavailableException expected) {
                // the stand-in answer of the first question
            }
        });
        assertThat(busy.await(5, TimeUnit.SECONDS)).isTrue();
        assertThatThrownBy(() -> service.ask(HELLO)).isInstanceOf(RateLimitExceededException.class);

        release.countDown();
        first.join(Duration.ofSeconds(5));
    }
}
