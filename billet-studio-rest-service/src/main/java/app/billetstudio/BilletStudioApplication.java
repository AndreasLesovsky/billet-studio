package app.billetstudio;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class BilletStudioApplication {

    public static void main(String[] args) {
        SpringApplication.run(BilletStudioApplication.class, args);
    }

}
