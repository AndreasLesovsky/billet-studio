package app.billetstudio.support;

import java.nio.file.Files;
import java.nio.file.Path;

import org.testcontainers.mariadb.MariaDBContainer;
import org.testcontainers.utility.MountableFile;

/**
 * The one throwaway MariaDB of a test run. Started on first use and left to the Testcontainers reaper at JVM
 * exit, so every IT class and every cached Spring context talks to the same server: a container per class would
 * be stopped while a cached context still points at it.
 *
 * The schema comes from the REAL ../sql/schema.sql and ../sql/seed_roles.sql (never Hibernate DDL), so an entity
 * that drifts from the delivered SQL fails here instead of on the user's database.
 */
final class MariaDbContainer {

    private static final Path SQL_DIR = Path.of("..", "sql").toAbsolutePath().normalize();

    private MariaDbContainer() {
    }

    static MariaDBContainer instance() {
        return Holder.CONTAINER;
    }

    /** Initialised on first access only, so a class that Docker's absence disabled never starts anything. */
    private static final class Holder {
        private static final MariaDBContainer CONTAINER = start();
    }

    private static MariaDBContainer start() {
        MariaDBContainer container = new MariaDBContainer("mariadb:10.11")
            // The image runs /docker-entrypoint-initdb.d/*.sql in name order against the test database, as the
            // mysql user - hence the explicit world-readable mode.
            .withCopyFileToContainer(sqlFile("schema.sql"), "/docker-entrypoint-initdb.d/01-schema.sql")
            .withCopyFileToContainer(sqlFile("seed_roles.sql"), "/docker-entrypoint-initdb.d/02-seed_roles.sql");
        container.start();
        return container;
    }

    private static MountableFile sqlFile(String name) {
        Path file = SQL_DIR.resolve(name);
        if (!Files.isRegularFile(file)) {
            throw new IllegalStateException("Missing " + file + " - run the tests from billet-studio-rest-service/");
        }
        return MountableFile.forHostPath(file, 0644);
    }
}
