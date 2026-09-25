package app.billetstudio.auth.controller;

import java.time.temporal.ChronoUnit;
import java.util.List;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.dto.ToggleActiveRequestDto;
import app.billetstudio.auth.dto.UserRequestDto;
import app.billetstudio.auth.dto.UserResponseDto;
import app.billetstudio.auth.entity.Role;
import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.RoleRepository;
import app.billetstudio.auth.security.RefreshCookie;
import app.billetstudio.auth.service.AuthSessionService;
import app.billetstudio.auth.service.UserService;
import app.billetstudio.shared.dto.PageDto;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin user management. */
@RestController
@RequestMapping("/v1/users")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final RoleRepository roleRepository;
    private final AuthSessionService authSessionService;
    private final RefreshCookie refreshCookie;

    /**
     * One page of users. q matches name or email; active filters by state (empty = both); sort is
     * "field[,asc|desc]" over name, email, createdAt, role. size must be 1..{@link UserService#MAX_PAGE_SIZE} and
     * page >= 0; anything else is VALIDATION_ERROR.
     */
    @GetMapping
    public ResponseEntity<PageDto<UserResponseDto>> listUsers(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String q,
        @RequestParam(required = false) Boolean active,
        @RequestParam(required = false) String sort) {
        return ResponseEntity.ok(userService.listUsers(page, size, q, active, sort));
    }

    @GetMapping("/roles")
    public ResponseEntity<List<String>> getAllRoles() {
        return ResponseEntity.ok(roleRepository.findAll(Sort.by("id")).stream().map(Role::getName).toList());
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserResponseDto> getUserById(@PathVariable Long id) {
        return ResponseEntity.ok(userService.getUserById(id));
    }

    @PostMapping
    @RateLimited(limit = 60, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<UserResponseDto> createUser(@Valid @RequestBody UserRequestDto input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(userService.createUser(input));
    }

    @PutMapping("/{id}")
    @RateLimited(limit = 60, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<UserResponseDto> updateUser(
        @AuthenticationPrincipal User currentUser,
        @PathVariable Long id,
        @Valid @RequestBody UserRequestDto input) {
        UserService.UserUpdate updated = userService.updateUser(id, input, currentUser.getId());
        if (updated.ownPasswordChanged()) {
            // The change ended every session, this one included. Hand the caller a new one so they stay where
            // they are; every other device is logged out, which is the whole point.
            AuthSessionService.IssuedSession issued = authSessionService.startSession(currentUser);
            return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie
                    .issue(issued.rawToken(), authSessionService.remainingFor(issued.session())).toString())
                .body(updated.user());
        }
        return ResponseEntity.ok(updated.user());
    }

    /** Hard delete; the account's sessions and billets go with it. */
    @DeleteMapping("/{id}")
    @RateLimited(limit = 30, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<Void> deleteUser(@AuthenticationPrincipal User currentUser, @PathVariable Long id) {
        userService.deleteUser(id, currentUser.getId());
        return ResponseEntity.noContent().build();
    }

    /** Toggles the active flag and returns the new state. No grace period, no email. */
    @PatchMapping("/{id}/active")
    @RateLimited(limit = 30, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<UserResponseDto> toggleActive(
        @AuthenticationPrincipal User currentUser,
        @PathVariable Long id,
        @RequestBody(required = false) ToggleActiveRequestDto request) {
        return ResponseEntity.ok(
            userService.toggleActive(id, currentUser.getId(), request != null ? request.reason() : null));
    }
}
