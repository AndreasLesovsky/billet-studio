package app.billetstudio.auth.bootstrap;

import java.util.Set;

import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.service.Roles;
import app.billetstudio.auth.validation.PasswordRules;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Bootstraps + reconciles the break-glass root user from env on every boot (self-healing). */
@Slf4j
@Component
@RequiredArgsConstructor
public class RootUserBootstrap implements ApplicationRunner {

    private static final int MIN_PASSWORD_LENGTH = 16;
    private static final String DEFAULT_NAME = "Root";

    // The root passwords that ship in the repository (application.yml fallback, .env.example), and are therefore
    // public. Keep in sync with both; RootUserBootstrapTest reads them.
    private static final Set<String> IN_REPO_PASSWORDS = Set.of(
        "local-dev-root-password-change-in-production",
        "change-me-local-root-password");

    // The root address both of them ship (application.yml fallback and .env.example); RootUserBootstrapTest reads it.
    private static final String IN_REPO_EMAIL = "root@local.dev";

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final BCryptPasswordEncoder passwordEncoder;

    @Value("${app.root.email:}")
    private String rootEmail;
    @Value("${app.root.password:}")
    private String rootPassword;
    @Value("${app.root.name:Root}")
    private String rootName;
    @Value("${app.security.enforce-strong-secrets:false}")
    private boolean enforceStrongSecrets;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        validateCredentials();
        String email = rootEmail.trim();

        // Never silently take over an existing normal user that already owns ROOT_EMAIL.
        User existing = userRepository.findByEmail(email).orElse(null);
        if (existing != null && !existing.isProtectedAccount()) {
            throw new IllegalStateException(
                "ROOT_EMAIL '" + email + "' already belongs to a normal (non-protected) user. "
                    + "Refusing silent takeover -- use a dedicated root address, or migrate that user first.");
        }

        // Roles are seed data with fixed ids, so the bootstrap never creates one.
        Role adminRole = roleRepository.findByName(Roles.ADMIN).orElseThrow(() -> new IllegalStateException(
            Roles.ADMIN + " is missing in tbl_roles. Run sql/seed_roles.sql (see sql/README.md)."));

        // Reconcile the root row from env (create if missing).
        User root = existing != null ? existing : new User();
        root.setEmail(email);
        root.setName((rootName != null && !rootName.isBlank()) ? rootName.trim() : DEFAULT_NAME);
        root.setPasswordHash(passwordEncoder.encode(rootPassword));
        root.setRole(adminRole);
        root.setActive(true);
        root.setProtectedAccount(true);
        root.setResetTokenHash(null);
        root.setResetTokenExpiry(null);
        root.setDeactivatedAt(null);
        root.setDeletionScheduledAt(null);
        root.setDeactivationReason(null);
        userRepository.save(root);

        // Single-root: unprotect any stale protected row under a different email.
        int demoted = userRepository.demoteProtectedExcept(email);
        if (demoted > 0) {
            log.warn("Demoted {} stale protected user row(s) not matching the current ROOT_EMAIL", demoted);
        }

        log.info("Root (break-glass) user reconciled: email={}", email);
    }

    private void validateCredentials() {
        if (rootEmail == null || rootEmail.isBlank()) {
            throw new IllegalStateException(
                "ROOT_EMAIL is blank. Set the break-glass root email (see .env.example).");
        }
        if (enforceStrongSecrets && IN_REPO_EMAIL.equalsIgnoreCase(rootEmail.trim())) {
            throw new IllegalStateException(
                "ROOT_EMAIL is the placeholder that ships in the repository (" + IN_REPO_EMAIL + "). "
                    + "Set the address of a mailbox you control.");
        }
        if (rootPassword == null || rootPassword.isBlank()) {
            throw new IllegalStateException(
                "ROOT_PASSWORD is blank. Set a high-entropy break-glass root password "
                    + "(e.g. openssl rand -base64 24).");
        }
        // BCrypt refuses to hash more; checked here so the message names the variable.
        if (!PasswordRules.fitsBcrypt(rootPassword)) {
            throw new IllegalStateException(
                "ROOT_PASSWORD is longer than " + PasswordRules.MAX_BYTES + " bytes (UTF-8), the BCrypt limit.");
        }
        if (enforceStrongSecrets && rootPassword.length() < MIN_PASSWORD_LENGTH) {
            throw new IllegalStateException(
                "ROOT_PASSWORD is too weak (<" + MIN_PASSWORD_LENGTH + " chars). The root address is "
                    + "publicly known, so use a long high-entropy password: openssl rand -base64 24");
        }
        if (enforceStrongSecrets && IN_REPO_PASSWORDS.contains(rootPassword)) {
            throw new IllegalStateException(
                "ROOT_PASSWORD is a value that ships in the repository (dev-default or .env.example). "
                    + "Set a real one: openssl rand -base64 24");
        }
    }
}
