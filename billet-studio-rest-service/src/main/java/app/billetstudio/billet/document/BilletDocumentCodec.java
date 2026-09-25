package app.billetstudio.billet.document;

import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

import app.billetstudio.billet.exception.InvalidDocumentException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * The one place a {@link BilletDocument} becomes the stored JSON string and back. The output is normalized: record
 * component order, no indentation, unknown input fields already dropped by the records. Both are pinned on this
 * mapper, so a later spring.jackson setting (sorting, indent-output) cannot change what is stored. Two documents with
 * the same content therefore encode to the same string, which is what hasUnpublishedChanges compares - never encode a
 * document any other way.
 */
@Component
public class BilletDocumentCodec {

    private final JsonMapper mapper;
    private final int maxDocumentBytes;

    public BilletDocumentCodec(JsonMapper jsonMapper, @Value("${app.billet.max-document-bytes}") int maxDocumentBytes) {
        this.mapper = jsonMapper.rebuild()
            .disable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
            .disable(SerializationFeature.INDENT_OUTPUT)
            .build();
        this.maxDocumentBytes = maxDocumentBytes;
    }

    /**
     * @throws InvalidDocumentException
     *         when the normalized JSON exceeds app.billet.max-document-bytes, or holds an unpaired UTF-16 surrogate,
     *         which the database would store as '?' - the stored document would no longer equal this string
     */
    public String encode(BilletDocument document) {
        String json = mapper.writeValueAsString(document);
        int bytes = utf8Length(json);
        if (bytes > maxDocumentBytes) {
            throw new InvalidDocumentException("Document has " + bytes + " bytes, limit " + maxDocumentBytes);
        }
        return json;
    }

    /** A new encoder per call: CharsetEncoder is not thread-safe. String.getBytes would replace, not report. */
    private static int utf8Length(String json) {
        try {
            return StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .encode(CharBuffer.wrap(json))
                .remaining();
        } catch (CharacterCodingException e) {
            throw new InvalidDocumentException("Document contains an unpaired UTF-16 surrogate");
        }
    }

    public BilletDocument decode(String json) {
        return mapper.readValue(json, BilletDocument.class);
    }

    public int maxDocumentBytes() {
        return maxDocumentBytes;
    }
}
