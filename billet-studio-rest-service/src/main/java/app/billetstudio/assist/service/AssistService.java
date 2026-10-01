package app.billetstudio.assist.service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import app.billetstudio.assist.dto.AssistBilletDto;
import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistRequest;
import app.billetstudio.assist.dto.AssistStatus;
import app.billetstudio.assist.exception.AssistUnavailableException;
import app.billetstudio.assist.questionnaire.QuestionnaireClient;
import app.billetstudio.auth.exception.RateLimitExceededException;
import app.billetstudio.catalog.service.ModelCatalogService;

import lombok.extern.slf4j.Slf4j;

import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * The billet assistant: one message of a chat in, the billet it asks for out (docs/assist.md). The model answers only
 * the questionnaire's labels; everything the user sees is written by the frontend.
 *
 * One answer at a time: the GPU works through requests one by one anyway, and a queue longer than the answer timeout
 * would only time out. A request that finds no free slot within that time is told to try again (429). Loading the
 * model happens before the slot - every waiting request shares the one load - so the slot covers answering only.
 */
@Slf4j
@Service
public class AssistService {

    private static final Duration STATUS_LIFETIME = Duration.ofSeconds(10);

    private final QuestionnaireClient client;
    private final BilletQuestionnaire questionnaire;
    private final ModelCatalogService catalog;
    private final boolean enabled;
    private final boolean warmUpOnStart;
    private final Duration queueWait;
    private final Semaphore slot = new Semaphore(1, true);

    /** The last probe and when it ran (System.nanoTime); guarded by this. */
    private @Nullable AssistStatus probed;
    private long probedAt;

    public AssistService(QuestionnaireClient client, BilletQuestionnaire questionnaire, ModelCatalogService catalog,
        @Value("${app.assist.enabled}") boolean enabled,
        @Value("${app.assist.warm-up}") boolean warmUpOnStart,
        @Value("${app.assist.timeout}") Duration queueWait) {
        this.client = client;
        this.questionnaire = questionnaire;
        this.catalog = catalog;
        this.enabled = enabled;
        this.warmUpOnStart = warmUpOnStart;
        this.queueWait = queueWait;
    }

    /** Cached for a few seconds: every visit of the home page asks. Never loads the model. */
    public synchronized AssistStatus status() {
        if (!enabled) {
            return AssistStatus.DISABLED;
        }
        if (probed == null || System.nanoTime() - probedAt > STATUS_LIFETIME.toNanos()) {
            probed = client.status();
            probedAt = System.nanoTime();
        }
        return probed;
    }

    /** The user is about to ask: load the model now, so the answer does not wait for it. */
    public void warmUp() {
        if (enabled) {
            client.warmUp();
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void warmUpOnStart() {
        if (warmUpOnStart) {
            warmUp();
        }
    }

    /**
     * @throws AssistUnavailableException
     *         when the assistant is off or the model gives no usable answer in time
     * @throws RateLimitExceededException
     *         when another answer is still being worked out after the wait
     */
    public AssistReply ask(AssistRequest request) {
        if (!enabled) {
            throw new AssistUnavailableException("app.assist.enabled is false");
        }
        questionnaire.validate(request.conversation());
        client.awaitReady();
        AssistBilletDto offered = BilletQuestionnaire.offered(request.conversation());
        Map<String, String> answers;
        String written = null;
        acquireSlot();
        try {
            answers = client.answer(questionnaire.questionnaire(catalog.listActive()),
                questionnaire.state(request.conversation()));
            if (BilletQuestionnaire.needsMessageLanguage(offered, answers)) {
                written = client.answer(questionnaire.messageLanguageQuestionnaire(),
                    questionnaire.messageState(request.conversation())).get("messageLanguage");
            }
        } finally {
            slot.release();
        }
        return questionnaire.merge(offered, answers, written);
    }

    private void acquireSlot() {
        try {
            if (!slot.tryAcquire(queueWait.toMillis(), TimeUnit.MILLISECONDS)) {
                log.warn("No assist slot free within {}", queueWait);
                throw new RateLimitExceededException();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssistUnavailableException("Interrupted while waiting for an assist slot");
        }
    }
}
