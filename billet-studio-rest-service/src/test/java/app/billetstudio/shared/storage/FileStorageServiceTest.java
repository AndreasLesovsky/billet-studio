package app.billetstudio.shared.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

/** Storing, serving, replacing and removing an avatar file end to end is AccountControllerIT. */
class FileStorageServiceTest {

    @TempDir
    Path tempDir;

    private final FileStorageService service = new FileStorageService();
    private Path uploads;

    @BeforeEach
    void setUp() {
        uploads = tempDir.resolve("uploads");
        ReflectionTestUtils.setField(service, "uploadBaseDir", uploads.toString());
    }

    /** The URL WebConfig serves (/uploads/**) and the file it maps to. */
    private Path fileOf(String url) {
        return uploads.resolve(url.substring("/uploads/".length()));
    }

    /** A replacement that landed on the old name would be deleted as "the old file" once the switch committed. */
    @Test
    void twoAvatarsStoredInTheSameMillisecond_neverShareAFile() throws IOException {
        String first = service.storeAvatar(new byte[]{1}, 7L);
        String second = service.storeAvatar(new byte[]{2}, 7L);

        assertThat(first).isNotEqualTo(second);
        assertThat(Files.readAllBytes(fileOf(first))).containsExactly(1);
    }

    @Test
    void delete_refusesAPathThatEscapesTheUploadDirectory() throws IOException {
        Path victim = tempDir.resolve("victim.txt"); // sits OUTSIDE the uploads base
        Files.writeString(victim, "secret");

        // A crafted url that tries to climb out of the upload directory must be refused.
        service.delete("/uploads/avatars/../../victim.txt");

        assertThat(victim).exists();
    }
}
