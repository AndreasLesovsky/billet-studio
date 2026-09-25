package app.billetstudio.support;

import java.io.IOException;
import java.io.UncheckedIOException;

import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;

public final class StandaloneMvc {

    private StandaloneMvc() {
    }

    /**
     * application.yml as shipped, without the machine's environment variables or .env.local, so every ${VAR:default}
     * resolves to its default.
     */
    public static MockEnvironment shippedConfiguration() {
        MockEnvironment environment = new MockEnvironment();
        try {
            for (PropertySource<?> source : new YamlPropertySourceLoader()
                .load("application.yml", new ClassPathResource("application.yml"))) {
                environment.getPropertySources().addLast(source);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return environment;
    }
}
