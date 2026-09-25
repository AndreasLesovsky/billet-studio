package app.billetstudio.auth.exception;

import app.billetstudio.auth.entity.User;
import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class RootUserProtectedException extends ApiException {

    public RootUserProtectedException() {
        super("ROOT_USER_PROTECTED", HttpStatus.FORBIDDEN);
    }

    public static void assertNotProtected(User user) {
        if (user != null && user.isProtectedAccount()) {
            throw new RootUserProtectedException();
        }
    }
}
