package app.billetstudio.auth.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

/** A 500 on purpose: the roles are seed data (sql/seed_roles.sql), so a missing one is a setup error. */
public class RoleNotFoundException extends ApiException {

    public RoleNotFoundException(String roleName) {
        super("ROLE_NOT_FOUND", HttpStatus.INTERNAL_SERVER_ERROR, "Role not found: " + roleName);
    }
}
