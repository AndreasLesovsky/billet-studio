package app.billetstudio.auth.service;

import java.io.IOException;
import java.util.Objects;

import app.billetstudio.auth.dto.AccountDto;
import app.billetstudio.auth.dto.AccountUpdateDto;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.exception.UserNotFoundException;
import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.validation.LanguageRules;
import app.billetstudio.auth.validation.UserNameRules;
import app.billetstudio.shared.storage.AvatarImageProcessor;
import app.billetstudio.shared.storage.FileStorageService;
import app.billetstudio.shared.util.AfterCommit;

import lombok.extern.slf4j.Slf4j;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * The signed-in user's own profile: name, language and avatar. Password change and deactivation live in
 * UserService, next to the password checks they share with login and reset.
 */
@Slf4j
@Service
public class AccountService {

    private final UserRepository userRepository;
    private final FileStorageService fileStorageService;
    private final AvatarImageProcessor avatarImageProcessor;
    private final TransactionTemplate transactionTemplate;

    public AccountService(UserRepository userRepository, FileStorageService fileStorageService,
        AvatarImageProcessor avatarImageProcessor, PlatformTransactionManager transactionManager) {
        this.userRepository = userRepository;
        this.fileStorageService = fileStorageService;
        this.avatarImageProcessor = avatarImageProcessor;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /** The principal is loaded by JwtAuthenticationFilter on every request, so it is current. */
    public AccountDto getAccount(User user) {
        return toDto(user);
    }

    @Transactional
    public AccountDto updateAccount(Long userId, AccountUpdateDto input) {
        if (!UserNameRules.isValid(input.name())) {
            throw new ValidationException("Invalid name");
        }
        if (!LanguageRules.isSupported(input.preferredLanguage())) {
            throw new ValidationException("Invalid preferredLanguage");
        }
        User user = findUser(userId);
        user.setName(input.name());
        user.setPreferredLanguage(input.preferredLanguage());
        User saved = userRepository.save(user);

        log.info("Account updated: userId={}", userId);
        return toDto(saved);
    }

    /**
     * Not @Transactional: decoding an upload of up to 20 MB must not hold a database connection. The new file is
     * written first and the row switches to it in a short transaction; afterwards the file the row no longer
     * references is deleted - the old one once the switch has committed, the new one when it failed.
     */
    public AccountDto updateAvatar(Long userId, MultipartFile image) throws IOException {
        byte[] webp = avatarImageProcessor.processToWebp(image);
        String newUrl = fileStorageService.storeAvatar(webp, userId);
        AccountDto updated;
        try {
            updated = transactionTemplate.execute(status -> {
                User user = findUser(userId);
                String oldUrl = user.getAvatarUrl();
                user.setAvatarUrl(newUrl);
                User saved = userRepository.save(user);
                if (oldUrl != null && !oldUrl.equals(newUrl)) {
                    AfterCommit.run(() -> fileStorageService.delete(oldUrl));
                }
                return toDto(saved);
            });
        } catch (RuntimeException e) {
            fileStorageService.delete(newUrl);
            throw e;
        }
        log.info("Avatar updated: userId={}", userId);
        return Objects.requireNonNull(updated);
    }

    @Transactional
    public AccountDto removeAvatar(Long userId) {
        User user = findUser(userId);
        String oldUrl = user.getAvatarUrl();
        user.setAvatarUrl(null);
        User saved = userRepository.save(user);
        if (oldUrl != null) {
            AfterCommit.run(() -> fileStorageService.delete(oldUrl));
        }

        log.info("Avatar removed: userId={}", userId);
        return toDto(saved);
    }

    private User findUser(Long userId) {
        return userRepository.findById(userId).orElseThrow(UserNotFoundException::new);
    }

    private static AccountDto toDto(User user) {
        return new AccountDto(
            user.getId(),
            user.getName(),
            user.getEmail(),
            user.getRole().getName(),
            user.getPreferredLanguage(),
            user.getAvatarUrl(),
            user.getCreatedAt());
    }
}
