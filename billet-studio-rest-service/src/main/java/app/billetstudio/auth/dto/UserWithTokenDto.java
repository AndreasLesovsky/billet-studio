package app.billetstudio.auth.dto;

/**
 * Login and refresh answer. accessToken is the short-lived bearer; the long-lived half never reaches this
 * DTO - it rides in the refresh cookie. expiresInSeconds counts down to whichever session deadline falls
 * first: a duration and not a timestamp, so a browser clock that runs slow cannot shift it.
 */
public record UserWithTokenDto(Long id, String name, String email, String accessToken, String role,
    boolean reactivated, String avatarUrl, long expiresInSeconds) {
}
