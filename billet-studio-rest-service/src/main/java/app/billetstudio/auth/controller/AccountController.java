package app.billetstudio.auth.controller;

import java.io.IOException;
import java.time.temporal.ChronoUnit;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.dto.AccountDto;
import app.billetstudio.auth.dto.AccountUpdateDto;
import app.billetstudio.auth.dto.DeactivateAccountRequestDto;
import app.billetstudio.auth.dto.PasswordChangeDto;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AccountService;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.UserService;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** The signed-in user's own account. */
@RestController
@RequestMapping("/v1/account")
@RequiredArgsConstructor
public class AccountController {

    private final AccountService accountService;
    private final UserService userService;
    private final AuthSessionService authSessionService;
    private final RefreshCookie refreshCookie;

    @GetMapping
    public ResponseEntity<AccountDto> getAccount(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(accountService.getAccount(user));
    }

    @PutMapping
    public ResponseEntity<AccountDto> updateAccount(
        @AuthenticationPrincipal User user,
        @Valid @RequestBody AccountUpdateDto input) {
        return ResponseEntity.ok(accountService.updateAccount(user.getId(), input));
    }

    @PostMapping("/change-password")
    @RateLimited(limit = 5, duration = 15, unit = ChronoUnit.MINUTES)
    public ResponseEntity<Void> changePassword(
        @AuthenticationPrincipal User user,
        @Valid @RequestBody PasswordChangeDto input) {
        userService.changePassword(user.getId(), input.currentPassword(), input.newPassword(),
            input.confirmPassword());

        // The change ended every session, this one included. Hand the caller a new one so they stay where they
        // are; every other device is logged out, which is the whole point.
        AuthSessionService.IssuedSession issued = authSessionService.startSession(user);
        return ResponseEntity.noContent()
            .header(HttpHeaders.SET_COOKIE,
                refreshCookie.issue(issued.rawToken(), authSessionService.remainingFor(issued.session())).toString())
            .build();
    }

    /** Ends every session; a login within the grace period reactivates the account. */
    @PostMapping("/deactivate")
    @RateLimited(limit = 3, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<Void> deactivate(
        @AuthenticationPrincipal User user,
        @Valid @RequestBody DeactivateAccountRequestDto input) {
        userService.deactivateAccount(user.getId(), input.password(), input.reason());
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RateLimited(limit = 20, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<AccountDto> uploadAvatar(
        @AuthenticationPrincipal User user,
        @RequestParam("image") MultipartFile image) throws IOException {
        return ResponseEntity.ok(accountService.updateAvatar(user.getId(), image));
    }

    @DeleteMapping("/avatar")
    public ResponseEntity<AccountDto> removeAvatar(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(accountService.removeAvatar(user.getId()));
    }
}
