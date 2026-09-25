package app.billetstudio.auth.event;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Guards the one runtime assumption behind the sealed interface: a plain payload object that implements
 * {@link AccountEvent}, published via the ApplicationEventPublisher, is delivered to a listener typed to the
 * interface (Spring wraps it in a PayloadApplicationEvent). Uses a plain {@code @EventListener} because the type
 * matching is identical to {@code @TransactionalEventListener} - only the commit-phase gating differs.
 */
class AccountEventDeliveryTest {

    @Component
    static class Collector {
        final List<AccountEvent> received = new ArrayList<>();

        @EventListener
        void on(AccountEvent event) {
            received.add(event);
        }
    }

    @Test
    void interfaceTypedListenerReceivesEachSealedSubtype() {
        try (var ctx = new AnnotationConfigApplicationContext(Collector.class)) {
            ctx.publishEvent(new AccountEvent.Deactivated(1L, Instant.now().plus(Duration.ofDays(30))));
            ctx.publishEvent(new AccountEvent.Reactivated(2L));
            ctx.publishEvent(new AccountEvent.DeletedByScheduler("ada@example.de", "Ada", "de"));
            ctx.publishEvent(new AccountEvent.DeletedByAdmin("cid@example.de", "Cid", "en"));

            List<AccountEvent> received = ctx.getBean(Collector.class).received;
            assertThat(received).hasSize(4);
            assertThat(received.get(0)).isInstanceOf(AccountEvent.Deactivated.class);
            assertThat(received.get(1)).isInstanceOf(AccountEvent.Reactivated.class);
            assertThat(received.get(2)).isInstanceOf(AccountEvent.DeletedByScheduler.class);
            assertThat(received.get(3)).isInstanceOf(AccountEvent.DeletedByAdmin.class);
        }
    }
}
