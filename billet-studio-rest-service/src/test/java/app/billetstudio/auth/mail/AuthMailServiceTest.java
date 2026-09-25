package app.billetstudio.auth.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * The composed message (subject, sender, language, date) and where a reset link may and may not end up. Whether each
 * template renders at all is EmailTemplateRenderTest.
 */
class AuthMailServiceTest {

    private static final String RESET_LINK = "https://billet.example.com/reset-password?token=abc";

    private final JavaMailSender mailSender = mock(JavaMailSender.class);
    private final AuthMailService service = new AuthMailService(mailSender, MailTestSupport.engine(),
        MailTestSupport.messages());

    private final Logger logger = (Logger) LoggerFactory.getLogger(AuthMailService.class);
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "siteName", "billet-studio");
        ReflectionTestUtils.setField(service, "frontendUrl", "https://billet.example.com/");
        ReflectionTestUtils.setField(service, "fromEmail", "noreply@example.com");
        ReflectionTestUtils.setField(service, "contactEmail", "kontakt@example.com");
        ReflectionTestUtils.setField(service, "logoUrl", "");
        ReflectionTestUtils.setField(service, "enforceStrongSecrets", false);
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(logs);
    }

    private void enableMail() {
        ReflectionTestUtils.setField(service, "mailEnabled", true);
        when(mailSender.createMimeMessage()).thenReturn(new MimeMessage((Session) null));
    }

    private MimeMessage sentMessage() {
        ArgumentCaptor<MimeMessage> captor = ArgumentCaptor.forClass(MimeMessage.class);
        verify(mailSender).send(captor.capture());
        return captor.getValue();
    }

    /**
     * A production deployment that forgot MAIL_ENABLED=true would otherwise turn every forgot-password request into
     * a working reset link for anyone who can read the log (shipping, support).
     */
    @Test
    void disabled_mail_in_production_never_writes_the_reset_link_to_the_log() {
        ReflectionTestUtils.setField(service, "enforceStrongSecrets", true);

        service.sendPasswordReset(new MailRecipient("anne@example.com", "Anne", "de"), RESET_LINK);

        verify(mailSender, never()).send(any(MimeMessage.class));
        assertThat(logs.list).anySatisfy(event -> assertThat(event.getFormattedMessage())
            .contains("Mail suppressed")
            .contains("email/password-reset_de"));
        assertThat(logs.list).noneSatisfy(event -> assertThat(event.getFormattedMessage()).contains("token="));
    }

    @Test
    void enabled_mail_goes_out_with_a_localized_subject_and_the_site_name_as_sender() throws Exception {
        enableMail();

        service.sendPasswordReset(new MailRecipient("anne@example.com", "Anne", "de"), RESET_LINK);

        MimeMessage message = sentMessage();
        assertThat(message.getSubject()).isEqualTo("Passwort zurücksetzen - billet-studio");
        assertThat(message.getFrom()[0].toString()).isEqualTo("billet-studio <noreply@example.com>");
        assertThat(message.getAllRecipients()[0].toString()).isEqualTo("anne@example.com");
        assertThat((String) message.getContent()).contains(RESET_LINK).contains("Hallo Anne,");
        assertThat(logs.list).noneSatisfy(event -> assertThat(event.getFormattedMessage()).contains(RESET_LINK));
    }

    @Test
    void english_recipients_get_the_english_template_and_subject() throws Exception {
        enableMail();

        service.sendWelcome(new MailRecipient("tom@example.com", "Tom", "en"));

        MimeMessage message = sentMessage();
        assertThat(message.getSubject()).isEqualTo("Welcome to billet-studio!");
        assertThat((String) message.getContent()).contains("Hello Tom,").contains("https://billet.example.com\"");
    }

    @Test
    void the_deletion_date_is_the_day_in_the_app_zone_in_the_readers_format() throws Exception {
        enableMail();
        // 23:30 UTC is already the next day in Vienna (CEST, +2).
        Instant deletion = Instant.parse("2026-10-22T23:30:00Z");

        service.sendAccountDeactivated(new MailRecipient("anne@example.com", "Anne", "de"), deletion);

        assertThat((String) sentMessage().getContent()).contains("23.10.2026")
            .contains("https://billet.example.com/login");
    }
}
