package app.billetstudio.shared.config;

import app.billetstudio.shared.web.RequestBodyLimitAdvice;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.ConfigurableBeanFactory;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;

import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * Parser limits for every JSON body the API reads; Jackson's defaults allow one string of 100 million characters and a
 * document of any length. A violation surfaces as StreamConstraintsException, which GlobalExceptionHandler answers with
 * 400 VALIDATION_ERROR.
 *
 * The limits live on the immutable JsonFactory, which a JsonMapperBuilderCustomizer cannot replace. So this builder
 * takes the place of Boot's (@ConditionalOnMissingBean, prototype) and applies the customizers exactly as Boot does -
 * spring.jackson.* and every other customizer still apply.
 */
@Configuration
public class JacksonConfig {

    /** Far over the longest text field (a paragraph, 2000 characters). */
    static final int MAX_STRING_LENGTH = 65536;
    /** The deepest body, an import, nests five levels. */
    static final int MAX_NESTING_DEPTH = 32;

    @Bean
    @Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
    JsonMapper.Builder jsonMapperBuilder(ObjectProvider<JsonMapperBuilderCustomizer> customizers,
        @Value("${app.billet.max-document-bytes}") int maxDocumentBytes) {
        StreamReadConstraints limits = StreamReadConstraints.builder()
            .maxStringLength(MAX_STRING_LENGTH)
            .maxNestingDepth(MAX_NESTING_DEPTH)
            .maxDocumentLength(RequestBodyLimitAdvice.importLimit(maxDocumentBytes))
            .build();
        JsonMapper.Builder builder = JsonMapper.builder(JsonFactory.builder().streamReadConstraints(limits).build());
        customizers.orderedStream().forEach(customizer -> customizer.customize(builder));
        return builder;
    }
}
