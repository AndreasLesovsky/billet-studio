package app.billetstudio.auth.service;

import app.billetstudio.auth.entity.User;

public record AuthResult(User user, boolean reactivated) {
}
