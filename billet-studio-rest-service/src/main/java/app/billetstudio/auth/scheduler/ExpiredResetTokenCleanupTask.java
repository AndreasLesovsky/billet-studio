package app.billetstudio.auth.scheduler;

import java.time.Instant;

import app.billetstudio.auth.repository.UserRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Clears expired password-reset tokens. UserService.resetPassword only clears a token when someone tries to
 * use it after expiry; an abandoned reset flow would leave the hash and expiry in the row forever.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ExpiredResetTokenCleanupTask {

    private final UserRepository userRepository;

    @Scheduled(cron = "${app.scheduler.expired-reset-token-cleanup.cron:0 0 4 * * *}", zone = "UTC")
    @Transactional
    public void run() {
        int cleared = userRepository.clearExpiredResetTokens(Instant.now());
        if (cleared > 0) {
            log.info("Cleared {} expired password-reset tokens", cleared);
        } else {
            log.debug("Reset token cleanup run: nothing expired");
        }
    }
}
