package app.billetstudio.auth.mail;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;

import app.billetstudio.auth.validation.LanguageRules;
import app.billetstudio.shared.util.AppZone;

import jakarta.annotation.PostConstruct;
import jakarta.mail.internet.MimeMessage;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.MessageSource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

/**
 * Renders the auth mails from templates/email/{name}_{de|en}.html in the recipient's language and sends them
 * asynchronously. Never throws: every failure is logged, because the account change behind a mail has already
 * committed. Subjects come from messages*.properties (MAIL.SUBJECT.*), dates are formatted here - templates
 * never format a date themselves.
 *
 * With app.mail.enabled=false the mail is still rendered (a broken template shows up in the log) but not sent;
 * outside production the log line carries the reset link, so the reset flow works locally.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthMailService implements AuthMailer {

    /** The letter names a day, not a moment. */
    private static final Map<String, DateTimeFormatter> DATE_FORMATS = Map.of(
        "de", DateTimeFormatter.ofPattern("dd.MM.yyyy"),
        "en", DateTimeFormatter.ofPattern("yyyy-MM-dd"));

    private final JavaMailSender mailSender;
    private final TemplateEngine templateEngine;
    private final MessageSource messageSource;

    @Value("${app.mail.enabled:false}")
    private boolean mailEnabled;

    // The production marker. There a reset link in the log is a working credential for anyone who reads the log.
    @Value("${app.security.enforce-strong-secrets:true}")
    private boolean enforceStrongSecrets;

    @Value("${app.site-name}")
    private String siteName;

    @Value("${app.frontend-url}")
    private String frontendUrl;

    @Value("${app.from-email}")
    private String fromEmail;

    @Value("${app.contact-email}")
    private String contactEmail;

    @Value("${app.logo-url:}")
    private String logoUrl;

    /** Not a boot failure: nothing leaks, but no reset, welcome or deactivation mail reaches anyone. */
    @PostConstruct
    void reportDisabledMailInProduction() {
        if (!mailEnabled && enforceStrongSecrets) {
            log.error(
                "app.mail.enabled=false in a production configuration (app.security.enforce-strong-secrets=true): "
                    + "no mail is sent and password resets cannot work. Set MAIL_ENABLED=true and the SMTP settings.");
        }
    }

    @Async
    @Override
    public void sendWelcome(MailRecipient recipient) {
        send(recipient, "welcome", "MAIL.SUBJECT.WELCOME", Map.of(), null);
    }

    @Async
    @Override
    public void sendPasswordReset(MailRecipient recipient, String resetLink) {
        send(recipient, "password-reset", "MAIL.SUBJECT.PASSWORD_RESET", Map.of("resetLink", resetLink), resetLink);
    }

    @Async
    @Override
    public void sendAccountDeactivated(MailRecipient recipient, Instant deletionDate) {
        String lang = LanguageRules.orDefault(recipient.preferredLanguage());
        send(recipient, "account-deactivation", "MAIL.SUBJECT.ACCOUNT_DEACTIVATED", Map.of(
            "deletionDate", DATE_FORMATS.get(lang).format(deletionDate.atZone(AppZone.ZONE)),
            "loginUrl", frontendBase() + "/login"), null);
    }

    @Async
    @Override
    public void sendAccountDeletionCancelled(MailRecipient recipient) {
        send(recipient, "account-deletion-cancelled", "MAIL.SUBJECT.ACCOUNT_DELETION_CANCELLED", Map.of(), null);
    }

    @Async
    @Override
    public void sendAccountDeleted(MailRecipient recipient) {
        send(recipient, "account-deleted", "MAIL.SUBJECT.ACCOUNT_DELETED", Map.of(), null);
    }

    @Async
    @Override
    public void sendAccountDeletedByAdmin(MailRecipient recipient) {
        send(recipient, "account-deleted-by-admin", "MAIL.SUBJECT.ACCOUNT_DELETED_BY_ADMIN", Map.of(), null);
    }

    /**
     * @param suppressedLink
     *        written to the log when sending is disabled outside production - the one piece of a mail a developer
     *        needs locally
     */
    private void send(MailRecipient recipient, String template, String subjectKey, Map<String, Object> variables,
        @Nullable String suppressedLink) {
        String lang = LanguageRules.orDefault(recipient.preferredLanguage());
        String templateName = "email/" + template + "_" + lang;
        try {
            Locale locale = Locale.forLanguageTag(lang);
            String subject = messageSource.getMessage(subjectKey, new Object[]{siteName}, locale);
            String body = templateEngine.process(templateName, context(locale, recipient, variables));

            if (!mailEnabled) {
                if (suppressedLink != null && !enforceStrongSecrets) {
                    log.info("Mail suppressed (app.mail.enabled=false): template={}, to={}, link={}", templateName,
                        recipient.email(), suppressedLink);
                } else {
                    log.info("Mail suppressed (app.mail.enabled=false): template={}, to={}", templateName,
                        recipient.email());
                }
                return;
            }

            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(fromEmail, siteName);
            helper.setTo(recipient.email());
            helper.setSubject(subject);
            helper.setText(body, true);
            mailSender.send(message);
            log.info("Mail sent: template={}, to={}", templateName, recipient.email());
        } catch (Exception e) {
            log.error("Failed to send mail: template={}, to={}", templateName, recipient.email(), e);
        }
    }

    /** The union of what _fragments.html reads, plus the mail's own variables. */
    private Context context(Locale locale, MailRecipient recipient, Map<String, Object> variables) {
        Context ctx = new Context(locale);
        ctx.setVariable("siteName", siteName);
        ctx.setVariable("logoUrl", logoUrl == null || logoUrl.isBlank() ? null : logoUrl);
        ctx.setVariable("contactEmail", contactEmail);
        ctx.setVariable("frontendUrl", frontendBase());
        ctx.setVariable("greetingName", recipient.name());
        ctx.setVariables(variables);
        return ctx;
    }

    private String frontendBase() {
        return frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
    }
}
