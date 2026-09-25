package app.billetstudio.auth.dto;

import app.billetstudio.auth.enums.DeactivationReason;

/**
 * Admin create and edit. A blank password on edit keeps the current one; a null active leaves the flag as
 * it is. Every rule is checked in UserService.
 */
public record UserRequestDto(String name, String email, String password, String role, String preferredLanguage,
    Boolean active, DeactivationReason deactivationReason) {
}
