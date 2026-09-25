package app.billetstudio.auth.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import app.billetstudio.auth.dto.RegisterRequestDto;
import app.billetstudio.auth.dto.UserRequestDto;
import app.billetstudio.auth.dto.UserResponseDto;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.enums.DeactivationReason;
import app.billetstudio.auth.event.AccountEvent;
import app.billetstudio.auth.exception.AccountAlreadyDeactivatedException;
import app.billetstudio.auth.exception.CannotDeactivateSelfException;
import app.billetstudio.auth.exception.CannotDeleteSelfException;
import app.billetstudio.auth.exception.EmailAlreadyExistsException;
import app.billetstudio.auth.exception.InvalidPasswordException;
import app.billetstudio.auth.exception.InvalidTokenException;
import app.billetstudio.auth.exception.JwtAuthException;
import app.billetstudio.auth.exception.PasswordMismatchException;
import app.billetstudio.auth.exception.RoleNotFoundException;
import app.billetstudio.auth.exception.RootUserProtectedException;
import app.billetstudio.auth.exception.TokenExpiredException;
import app.billetstudio.auth.exception.UserNotFoundException;
import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.auth.mail.AuthMailer;
import app.billetstudio.auth.mail.MailRecipient;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.validation.LanguageRules;
import app.billetstudio.auth.validation.PasswordRules;
import app.billetstudio.auth.validation.UserNameRules;
import app.billetstudio.shared.dto.PageDto;
import app.billetstudio.shared.storage.FileStorageService;
import app.billetstudio.shared.util.AfterCommit;
import app.billetstudio.shared.util.SecureTokens;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserService {

    private static final int DELETION_GRACE_PERIOD_DAYS = 30;
    private static final Duration RESET_TOKEN_LIFETIME = Duration.ofHours(1);
    private static final int RESET_TOKEN_BYTES = 32;

    private static final int EMAIL_MAX_LENGTH = 150;
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}$");

    public static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Direction.DESC, "createdAt", "id");
    /** API sort field -> entity path; any other field is a VALIDATION_ERROR. */
    private static final Map<String, String> SORT_FIELDS = Map.of(
        "name", "name",
        "email", "email",
        "createdAt", "createdAt",
        "role", "role.name");

    /**
     * Compared against when the email is unknown, so a miss costs one BCrypt round like a hit and the response
     * time does not tell which emails have an account. Same (default) strength as the passwordEncoder bean.
     */
    private static final String DUMMY_HASH = new BCryptPasswordEncoder().encode(SecureTokens.urlSafeToken(16));

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final AuthSessionService authSessionService;
    private final BCryptPasswordEncoder passwordEncoder;
    private final AuthMailer authMailer;
    private final FileStorageService fileStorageService;
    private final ApplicationEventPublisher eventPublisher;

    @Value("${app.frontend-url}")
    private String frontendUrl;

    // ============================================
    // CREATE
    // ============================================

    /** Public sign-up: always ROLE_USER and active. */
    @Transactional
    public UserResponseDto register(RegisterRequestDto input) {
        return toDto(create(input.name(), input.email(), input.password(), Roles.USER, input.preferredLanguage(),
            true, null));
    }

    /** Admin create. A blank role falls back to ROLE_USER. */
    @Transactional
    public UserResponseDto createUser(UserRequestDto input) {
        assertReasonChosenBy(input.deactivationReason(), DeactivationReason.Actor.ADMIN);
        String roleName = hasText(input.role()) ? input.role() : Roles.USER;
        boolean active = input.active() == null || input.active();
        return toDto(create(input.name(), input.email(), input.password(), roleName, input.preferredLanguage(),
            active, input.deactivationReason()));
    }

    private User create(String name, String email, String password, String roleName, String preferredLanguage,
        boolean active, DeactivationReason reason) {
        validateName(name);
        validateEmail(email);
        validateLanguage(preferredLanguage);
        validateNewPassword(password);

        if (userRepository.existsByEmail(email)) {
            throw new EmailAlreadyExistsException();
        }

        User user = new User();
        user.setName(name);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setRole(findRole(roleName));
        user.setPreferredLanguage(preferredLanguage != null ? preferredLanguage : LanguageRules.DEFAULT);
        user.setActive(active);
        if (!active) {
            user.setDeactivatedAt(Instant.now());
            user.setDeactivationReason(reason);
        }
        user = userRepository.save(user);

        MailRecipient recipient = MailRecipient.of(user);
        AfterCommit.run(() -> authMailer.sendWelcome(recipient));

        log.info("User created: id={}, email={}", user.getId(), user.getEmail());
        return user;
    }

    // ============================================
    // READ
    // ============================================

    /**
     * Admin list. q matches name or email (case-insensitive substring); sort is "field" or "field,asc|desc"
     * over {@link #SORT_FIELDS}, defaulting to newest first.
     */
    @Transactional(readOnly = true)
    public PageDto<UserResponseDto> listUsers(int page, int size, String q, Boolean active, String sort) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ValidationException("Page out of range: page=" + page + ", size=" + size);
        }
        PageRequest pageable = PageRequest.of(page, size, parseSort(sort));
        return PageDto.of(userRepository.searchAdmin(likePattern(q), active, pageable), this::toDto);
    }

    @Transactional(readOnly = true)
    public UserResponseDto getUserById(Long id) {
        return userRepository.findById(id)
            .map(this::toDto)
            .orElseThrow(UserNotFoundException::new);
    }

    // ============================================
    // UPDATE (admin)
    // ============================================

    /**
     * The updated user, and whether the caller just replaced their OWN password. The second half is the
     * controller's cue to issue a replacement session: the change revokes every session of the account, this
     * one included.
     */
    public record UserUpdate(UserResponseDto user, boolean ownPasswordChanged) {
    }

    @Transactional
    public UserUpdate updateUser(Long id, UserRequestDto input, Long currentUserId) {
        validateName(input.name());
        validateEmail(input.email());
        validateLanguage(input.preferredLanguage());
        boolean passwordChanged = hasText(input.password());
        if (passwordChanged) {
            validateNewPassword(input.password());
        }
        assertReasonChosenBy(input.deactivationReason(), DeactivationReason.Actor.ADMIN);

        // The same one-way door toggleActive guards: this endpoint writes `active` too, so the editor's
        // disabled switch would otherwise be the only thing standing between an admin and locking themselves
        // out.
        if (Boolean.FALSE.equals(input.active()) && id.equals(currentUserId)) {
            throw new CannotDeactivateSelfException();
        }

        User user = userRepository.findById(id).orElseThrow(UserNotFoundException::new);
        RootUserProtectedException.assertNotProtected(user);
        if (userRepository.existsByEmailAndIdNot(input.email(), id)) {
            throw new EmailAlreadyExistsException();
        }

        user.setName(input.name());
        user.setEmail(input.email());
        if (input.preferredLanguage() != null) {
            user.setPreferredLanguage(input.preferredLanguage());
        }
        if (passwordChanged) {
            user.setPasswordHash(passwordEncoder.encode(input.password()));
            // A reset token requested before this edit would outlive the new hash and hand its holder a
            // second way in for the rest of its hour. resetPassword clears the pair for the same reason.
            user.setResetTokenHash(null);
            user.setResetTokenExpiry(null);
        }
        if (hasText(input.role())) {
            user.setRole(findRole(input.role()));
        }
        if (input.active() != null) {
            boolean selfDeactivated = !user.isActive() && user.getDeletionScheduledAt() != null;
            user.setActive(input.active());
            if (input.active()) {
                clearDeactivation(user);
            } else if (!selfDeactivated || input.deactivationReason() != null) {
                // An admin lock, as in toggleActive, so no pending deletionScheduledAt may survive it: authenticate()
                // reads that as permission to reactivate. Only a plain edit (no reason) of a self-deactivated
                // account keeps its grace period and its owner's reason.
                if (user.getDeactivatedAt() == null) {
                    user.setDeactivatedAt(Instant.now());
                }
                user.setDeletionScheduledAt(null);
                user.setDeactivationReason(input.deactivationReason());
            }
        }
        // Flushed so @PreUpdate has stamped updatedAt before the DTO is built.
        User updated = userRepository.saveAndFlush(user);

        // A new hash must not leave the account's existing refresh tokens alive, and a lock applied here must
        // not be survivable by one.
        if (passwordChanged || Boolean.FALSE.equals(input.active())) {
            authSessionService.endAllSessions(id);
        }
        log.info("User updated: id={}", updated.getId());
        return new UserUpdate(toDto(updated), passwordChanged && id.equals(currentUserId));
    }

    // ============================================
    // ACCOUNT LIFECYCLE - USER SELF
    // ============================================

    /**
     * Ends every session of the account, the caller's included: changing a password is how someone shuts out
     * whoever else got in. The controller hands the caller a fresh session; every other device has to log in
     * again. The caller's current access token keeps working until it expires, which is why it is short.
     */
    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword, String confirmPassword) {
        validateNewPassword(newPassword);

        User user = userRepository.findById(userId).orElseThrow(UserNotFoundException::new);
        // Root credentials are env-managed: RootUserBootstrap writes them on every boot.
        RootUserProtectedException.assertNotProtected(user);

        if (!passwordMatches(currentPassword, user.getPasswordHash())) {
            log.warn("Failed password change attempt (wrong current password): userId={}", userId);
            throw new InvalidPasswordException();
        }
        if (!newPassword.equals(confirmPassword)) {
            throw new PasswordMismatchException();
        }

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        // Same reason as the admin password set: an open reset link must not outlive the new hash.
        user.setResetTokenHash(null);
        user.setResetTokenExpiry(null);
        userRepository.save(user);

        authSessionService.endAllSessions(userId);
        log.info("Password changed, all sessions ended: userId={}", userId);
    }

    @Transactional
    public void deactivateAccount(Long userId, String password, DeactivationReason reason) {
        assertReasonChosenBy(reason, DeactivationReason.Actor.USER);

        User user = userRepository.findById(userId).orElseThrow(UserNotFoundException::new);
        RootUserProtectedException.assertNotProtected(user);

        if (!passwordMatches(password, user.getPasswordHash())) {
            log.warn("Failed deactivation attempt (wrong password): userId={}", userId);
            throw new InvalidPasswordException();
        }
        if (!user.isActive()) {
            throw new AccountAlreadyDeactivatedException();
        }

        Instant now = Instant.now();
        user.setActive(false);
        user.setDeactivatedAt(now);
        user.setDeletionScheduledAt(now.plus(Duration.ofDays(DELETION_GRACE_PERIOD_DAYS)));
        user.setDeactivationReason(reason);
        userRepository.save(user);

        // The isActive checks already block everything. Dropping the rows matters for the auto-reactivation on
        // login inside the grace period, which would otherwise hand back every session the account had.
        authSessionService.endAllSessions(userId);

        eventPublisher.publishEvent(new AccountEvent.Deactivated(userId, user.getDeletionScheduledAt()));
        log.info("User self-deactivated: id={}, scheduledFor={}", userId, user.getDeletionScheduledAt());
    }

    // ============================================
    // ACCOUNT LIFECYCLE - ADMIN
    // ============================================

    /** No grace period, no email: an admin lock stays until an admin lifts it or deletes the account. */
    @Transactional
    public UserResponseDto toggleActive(Long userId, Long currentUserId, DeactivationReason reason) {
        assertReasonChosenBy(reason, DeactivationReason.Actor.ADMIN);

        User user = userRepository.findById(userId).orElseThrow(UserNotFoundException::new);
        RootUserProtectedException.assertNotProtected(user);

        boolean newActive = !user.isActive();
        // You cannot let yourself back in: an admin lock deliberately sets no deletionScheduledAt, and that
        // field is what authenticate() treats as permission to self-reactivate - a lock undone by simply
        // logging in would be no lock. Recovery needs another admin or the break-glass root account.
        if (!newActive && userId.equals(currentUserId)) {
            throw new CannotDeactivateSelfException();
        }
        user.setActive(newActive);
        if (newActive) {
            clearDeactivation(user);
        } else {
            user.setDeactivatedAt(Instant.now());
            user.setDeactivationReason(reason);
            // The lockout itself already holds (JwtAuthenticationFilter and AuthSessionService.refresh read
            // isActive). This is about AFTERWARDS: reactivating must not revive the sessions the account had.
            authSessionService.endAllSessions(userId);
        }
        User saved = userRepository.saveAndFlush(user);

        log.info("Admin toggled active: userId={}, newActive={}, reason={}", userId, newActive, reason);
        return toDto(saved);
    }

    // Must be @Transactional itself: permanentlyDeleteUser is called via this-reference, which bypasses the
    // proxy, and without a transaction the AFTER_COMMIT listener silently drops the AccountEvent.
    @Transactional
    public void deleteUser(Long id, Long currentUserId) {
        if (id.equals(currentUserId)) {
            throw new CannotDeleteSelfException();
        }
        User user = userRepository.findById(id).orElseThrow(UserNotFoundException::new);
        RootUserProtectedException.assertNotProtected(user);
        permanentlyDeleteUser(id, DeletionTrigger.ADMIN);
    }

    /**
     * Hard-delete. Sessions and billets go with the row through their ON DELETE CASCADE foreign keys; the
     * avatar file is removed once the delete has committed.
     */
    @Transactional
    public void permanentlyDeleteUser(Long userId, DeletionTrigger trigger) {
        User user = userRepository.findById(userId).orElseThrow(UserNotFoundException::new);
        RootUserProtectedException.assertNotProtected(user);

        // The scheduler read its list earlier; a login in between reactivates the account and must win.
        if (trigger == DeletionTrigger.SCHEDULER && !isDueForDeletion(user, Instant.now())) {
            log.info("Scheduled deletion skipped, account no longer due: id={}", userId);
            return;
        }

        // Copied before the delete - the row is gone when the AFTER_COMMIT listener fires.
        String email = user.getEmail();
        String name = user.getName();
        String preferredLanguage = user.getPreferredLanguage();
        String avatarUrl = user.getAvatarUrl();

        userRepository.delete(user);
        if (avatarUrl != null) {
            AfterCommit.run(() -> fileStorageService.delete(avatarUrl));
        }

        AccountEvent event = switch (trigger) {
        case SCHEDULER -> new AccountEvent.DeletedByScheduler(email, name, preferredLanguage);
        case ADMIN -> new AccountEvent.DeletedByAdmin(email, name, preferredLanguage);
        };
        eventPublisher.publishEvent(event);

        log.info("User permanently deleted: id={}, trigger={}", userId, trigger);
    }

    private static boolean isDueForDeletion(User user, Instant now) {
        return !user.isActive() && user.getDeletionScheduledAt() != null && user.getDeletionScheduledAt().isBefore(
            now);
    }

    // ============================================
    // AUTHENTICATE
    // ============================================

    /**
     * Every failure is the same JwtAuthException (401 UNAUTHORIZED): unknown email, wrong password, admin lock,
     * deactivated past the grace period.
     */
    @Transactional
    public AuthResult authenticate(String email, String password) {
        User user = userRepository.findByEmail(email).orElse(null);
        boolean passwordOk = passwordMatches(password, user != null ? user.getPasswordHash() : DUMMY_HASH);
        if (user == null || !passwordOk) {
            log.warn("Failed login attempt for email: {}", email);
            throw new JwtAuthException();
        }

        boolean reactivated = false;
        if (!user.isActive()) {
            Instant scheduledAt = user.getDeletionScheduledAt();
            if (scheduledAt != null && scheduledAt.isAfter(Instant.now())) {
                user.setActive(true);
                clearDeactivation(user);
                userRepository.save(user);
                reactivated = true;
                eventPublisher.publishEvent(new AccountEvent.Reactivated(user.getId()));
                log.info("User auto-reactivated on login: id={}", user.getId());
            } else {
                log.warn("Login refused for an inactive account: id={}", user.getId());
                throw new JwtAuthException();
            }
        }

        if (user.isProtectedAccount()) {
            log.warn("Break-glass root login: id={}, email={}", user.getId(), user.getEmail());
        }
        return new AuthResult(user, reactivated);
    }

    // ============================================
    // PASSWORD RESET
    // ============================================

    @Transactional
    public void requestPasswordReset(String email) {
        User user = userRepository.findByEmail(email).orElse(null);
        if (user == null) {
            // Silent no-op to prevent user enumeration
            log.info("Password reset requested for unknown email: {}", email);
            return;
        }
        // Root credentials are env-managed: never issue a reset token (same generic no-op, no enumeration).
        if (user.isProtectedAccount()) {
            log.warn("Password reset requested for the protected root email; no token issued: {}", email);
            return;
        }

        String plainToken = SecureTokens.urlSafeToken(RESET_TOKEN_BYTES);
        user.setResetTokenHash(SecureTokens.sha256Hex(plainToken));
        user.setResetTokenExpiry(Instant.now().plus(RESET_TOKEN_LIFETIME));
        userRepository.save(user);

        MailRecipient recipient = MailRecipient.of(user);
        String resetLink = stripTrailingSlash(frontendUrl) + "/reset-password?token=" + plainToken;
        AfterCommit.run(() -> authMailer.sendPasswordReset(recipient, resetLink));
        log.info("Password reset token generated for user: id={}", user.getId());
    }

    /** noRollbackFor: clearing an expired token is the one write before a refusal, and it must stick. */
    @Transactional(noRollbackFor = TokenExpiredException.class)
    public void resetPassword(String token, String newPassword, String confirmPassword) {
        if (!newPassword.equals(confirmPassword)) {
            throw new PasswordMismatchException();
        }
        validateNewPassword(newPassword);

        User user = userRepository.findByResetTokenHash(SecureTokens.sha256Hex(token))
            .orElseThrow(InvalidTokenException::new);
        RootUserProtectedException.assertNotProtected(user);

        if (user.getResetTokenExpiry() == null || user.getResetTokenExpiry().isBefore(Instant.now())) {
            user.setResetTokenHash(null);
            user.setResetTokenExpiry(null);
            userRepository.save(user);
            throw new TokenExpiredException();
        }

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setResetTokenHash(null);
        user.setResetTokenExpiry(null);
        userRepository.save(user);

        // The reason someone resets a forgotten password may be that somebody else has it. Every session the
        // account holds ends here, including the intruder's.
        authSessionService.endAllSessions(user.getId());

        log.info("Password reset successful for user: id={}", user.getId());
    }

    // ============================================
    // HELPERS
    // ============================================

    private UserResponseDto toDto(User user) {
        return new UserResponseDto(
            user.getId(),
            user.getName(),
            user.getEmail(),
            user.getRole() != null ? user.getRole().getName() : null,
            user.getPreferredLanguage(),
            user.getAvatarUrl(),
            user.isActive(),
            user.isProtectedAccount(),
            user.getDeactivatedAt(),
            user.getDeletionScheduledAt(),
            user.getDeactivationReason(),
            user.getCreatedAt(),
            user.getUpdatedAt());
    }

    private Role findRole(String roleName) {
        return roleRepository.findByName(roleName).orElseThrow(() -> new RoleNotFoundException(roleName));
    }

    private static void clearDeactivation(User user) {
        user.setDeactivatedAt(null);
        user.setDeletionScheduledAt(null);
        user.setDeactivationReason(null);
    }

    /**
     * Always exactly one BCrypt round. BCrypt itself compares only the first 72 bytes, so a longer input is
     * refused on top: no stored password is longer (PasswordRules), and a truncated match is no match.
     */
    private boolean passwordMatches(String rawPassword, String hash) {
        boolean matches = passwordEncoder.matches(rawPassword, hash);
        return matches && PasswordRules.fitsBcrypt(rawPassword);
    }

    /**
     * Each entry point polices its own half of {@link DeactivationReason}, so a user cannot claim FRAUD and an
     * admin cannot claim TOO_COMPLICATED. Null passes: the reason is optional.
     */
    private static void assertReasonChosenBy(DeactivationReason reason, DeactivationReason.Actor actor) {
        if (reason != null && !reason.isChosenBy(actor)) {
            throw new ValidationException("Deactivation reason " + reason + " is not an " + actor + " reason");
        }
    }

    private static void validateName(String name) {
        if (!UserNameRules.isValid(name)) {
            throw new ValidationException("Invalid name");
        }
    }

    private static void validateEmail(String email) {
        if (email == null || email.length() > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.matcher(email).matches()) {
            throw new ValidationException("Invalid email");
        }
    }

    /** Null means "not given" (the default applies); the endpoint is public, so the value is whitelisted. */
    private static void validateLanguage(String preferredLanguage) {
        if (preferredLanguage != null && !LanguageRules.isSupported(preferredLanguage)) {
            throw new ValidationException("Invalid preferredLanguage");
        }
    }

    private static void validateNewPassword(String password) {
        if (!PasswordRules.isValid(password)) {
            throw new ValidationException("Password does not meet the password rules");
        }
    }

    private static Sort parseSort(String sort) {
        if (!hasText(sort)) {
            return DEFAULT_SORT;
        }
        String[] parts = sort.split(",");
        String property = SORT_FIELDS.get(parts[0].trim());
        Sort.Direction direction = parts.length == 2
            ? Sort.Direction.fromOptionalString(parts[1].trim()).orElse(null)
            : parts.length == 1 ? Sort.Direction.ASC : null;
        if (property == null || direction == null) {
            throw new ValidationException("Invalid sort: " + sort);
        }
        // id as tie-breaker: without a unique last key, rows with equal values can repeat across pages.
        return Sort.by(direction, property).and(Sort.by(direction, "id"));
    }

    /** Lowercased substring pattern with '!' as the LIKE escape, or null when there is no text filter. */
    private static String likePattern(String q) {
        if (!hasText(q)) {
            return null;
        }
        String trimmed = q.trim();
        if (trimmed.length() > MAX_QUERY_LENGTH) {
            throw new ValidationException("Search query too long");
        }
        String escaped = trimmed.toLowerCase(Locale.ROOT)
            .replace("!", "!!")
            .replace("%", "!%")
            .replace("_", "!_");
        return "%" + escaped + "%";
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
