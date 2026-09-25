package app.billetstudio.auth.scheduler;

import java.time.Instant;
import java.util.List;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.service.DeletionTrigger;
import app.billetstudio.auth.service.UserService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Permanently deletes accounts whose 30-day grace period has elapsed.
 *
 * No @Transactional on the loop: each user runs in its own transaction (UserService.permanentlyDeleteUser),
 * so a single failure does not roll back the whole batch.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccountDeletionTask {

    private final UserRepository userRepository;
    private final UserService userService;

    @Scheduled(cron = "${app.scheduler.account-deletion.cron:0 0 3 * * *}", zone = "UTC")
    public void run() {
        List<User> expired = userRepository.findByActiveFalseAndDeletionScheduledAtBefore(Instant.now());
        if (expired.isEmpty()) {
            log.debug("Account deletion run: nothing due");
            return;
        }

        log.info("Found {} accounts with elapsed deletion grace period", expired.size());

        int success = 0;
        int failed = 0;
        for (User user : expired) {
            Long userId = user.getId();
            try {
                userService.permanentlyDeleteUser(userId, DeletionTrigger.SCHEDULER);
                success++;
            } catch (Exception e) {
                failed++;
                log.error("Scheduled deletion failed for userId={}, will retry next run", userId, e);
            }
        }

        log.info("Account deletion run complete: {} succeeded, {} failed", success, failed);
    }
}
