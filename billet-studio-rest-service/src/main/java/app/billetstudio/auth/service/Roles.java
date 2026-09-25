package app.billetstudio.auth.service;

/** Role names as seeded by sql/seed_roles.sql (ROLE_USER id 1, ROLE_ADMIN id 2). */
public final class Roles {

    public static final String USER = "ROLE_USER";
    public static final String ADMIN = "ROLE_ADMIN";

    private Roles() {
    }
}
