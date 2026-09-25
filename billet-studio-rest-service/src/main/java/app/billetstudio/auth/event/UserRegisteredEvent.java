package app.billetstudio.auth.event;

/**
 * A visitor signed themselves up. Published from AuthController#register, not from UserService: the create
 * path there also serves an admin adding a user by hand, which is not a registration.
 */
public record UserRegisteredEvent(Long userId, String name, String email) {
}
