package app.billetstudio.support;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import javax.sql.DataSource;

import app.billetstudio.auth.entity.User;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mariadb.MariaDBContainer;

/**
 * Base of every integration test: the shared Testcontainers MariaDB (schema.sql + seed_roles.sql) and a
 * configuration that cannot leak into anything real. Self-skips without Docker.
 *
 * The fixed properties pin everything a developer's .env.local could otherwise feed into the context (root
 * account, secrets, mail, DDL, cookie flag). They are @TestPropertySource and not @DynamicPropertySource on purpose:
 * a subclass can override them with its own @TestPropertySource, while dynamic properties would always win.
 *
 * The database outlives every test class of the run, so tests create their own rows under
 * {@link #uniqueEmail(String)} and never assume a table is empty.
 */
@Testcontainers(disabledWithoutDocker = true)
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=none",
    "spring.jpa.show-sql=false",
    "app.mail.enabled=false",
    "app.rate-limit.enabled=false",
    "app.security.enforce-strong-secrets=false",
    "app.jwt.secret=" + MariaDbITBase.JWT_SECRET,
    "app.root.email=" + MariaDbITBase.ROOT_EMAIL,
    "app.root.password=" + MariaDbITBase.ROOT_PASSWORD,
    "app.root.name=Root",
    "app.frontend-url=" + MariaDbITBase.FRONTEND_URL,
    "app.auth.cookie.secure=true",
    "app.upload.directory=" + MariaDbITBase.UPLOAD_DIRECTORY,
    "app.log.directory=target/it-logs"
})
public abstract class MariaDbITBase {

    protected static final String JWT_SECRET = "integration-tests-only-0123456789abcdef0123456789abcdef0123456789";
    protected static final String ROOT_EMAIL = "root@it.test";
    protected static final String ROOT_PASSWORD = "Root-password-of-the-integration-tests-1";
    protected static final String FRONTEND_URL = "http://localhost:4200";
    protected static final String UPLOAD_DIRECTORY = "target/it-uploads";

    private static final String RUN = UUID.randomUUID().toString().substring(0, 8);
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private DataSource dataSource;

    @DynamicPropertySource
    static void mariaDbProperties(DynamicPropertyRegistry registry) {
        MariaDBContainer mariaDb = MariaDbContainer.instance();
        registry.add("spring.datasource.url", mariaDb::getJdbcUrl);
        registry.add("spring.datasource.username", mariaDb::getUsername);
        registry.add("spring.datasource.password", mariaDb::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.mariadb.jdbc.Driver");
    }

    /** Unique across the run; the local part is safe for the backend's email pattern. */
    protected static String uniqueEmail(String prefix) {
        return prefix + "." + RUN + "." + SEQUENCE.incrementAndGet() + "@it.test";
    }

    /** Plain JDBC on the test's connection (inside a test transaction it sees that transaction's rows). */
    protected JdbcTemplate jdbc() {
        return new JdbcTemplate(dataSource);
    }

    protected long sessionsOf(User user) {
        Long count = jdbc().queryForObject("SELECT COUNT(*) FROM tbl_auth_sessions WHERE user_id = ?", Long.class,
            user.getId());
        return count != null ? count : 0;
    }
}
