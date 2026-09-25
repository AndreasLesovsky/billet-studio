package app.billetstudio.auth.scheduler;

import java.time.Duration;
import java.time.Instant;

import app.billetstudio.auth.repository.AuthSessionRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Deletes session rows that are past either deadline. Without it the table only ever grows: a user session can
 * be issued for 90 days and most are never logged out of, they simply stop being used.
 *
 * Nothing here enforces security - an expired row is already refused by AuthSessionService. This is
 * housekeeping, which is why the grace period is short: a dead session is not an audit trail.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PurgeExpiredAuthSessionsTask {

    private static final Duration GRACE_PERIOD = Duration.ofDays(1);

    private final AuthSessionRepository sessionRepository;

    @Scheduled(cron = "${app.scheduler.purge-expired-auth-sessions.cron:0 30 3 * * *}", zone = "UTC")
    @Transactional
    public void run() {
        Instant cutoff = Instant.now().minus(GRACE_PERIOD);
        int deleted = sessionRepository.deleteExpired(cutoff);
        if (deleted > 0) {
            log.info("Purged {} auth sessions that expired before {}", deleted, cutoff);
        } else {
            log.debug("Auth session purge run: nothing expired before {}", cutoff);
        }
    }
}
