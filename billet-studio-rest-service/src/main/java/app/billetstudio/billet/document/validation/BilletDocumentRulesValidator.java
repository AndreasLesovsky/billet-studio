package app.billetstudio.billet.document.validation;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import app.billetstudio.billet.document.BilletBlock;
import app.billetstudio.billet.document.BilletDocument;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Block rules that depend on another field: block ids are unique within the document, the text limit depends on
 * the block type, icon and ariaLabel belong to cards, dividerStyle to dividers. A missing or unknown value is left to
 * the field constraints, which report it on their own.
 */
public class BilletDocumentRulesValidator implements ConstraintValidator<ValidBilletDocument, BilletDocument> {

    private static final Map<String, Integer> TEXT_LIMIT = Map.of(
        "paragraph", 2000,
        "heading", 160,
        "card", 1200,
        "note", 600,
        "divider", 0);

    @Override
    public boolean isValid(BilletDocument document, ConstraintValidatorContext context) {
        if (document == null || document.blocks() == null) {
            return true;
        }
        context.disableDefaultConstraintViolation();
        boolean valid = true;
        Set<String> ids = new HashSet<>();
        List<BilletBlock> blocks = document.blocks();
        for (int i = 0; i < blocks.size(); i++) {
            BilletBlock block = blocks.get(i);
            if (block == null) {
                continue;
            }
            if (block.id() != null && !ids.add(block.id())) {
                valid = violation(context, i, "id", "must be unique within the document");
            }
            Integer limit = block.type() != null ? TEXT_LIMIT.get(block.type()) : null;
            if (limit == null) {
                continue;
            }
            if (block.text() != null && block.text().length() > limit) {
                valid = violation(context, i, "text", "exceeds " + limit + " characters for type " + block.type());
            }
            boolean card = "card".equals(block.type());
            if (!card && block.icon() != null && !block.icon().isEmpty()) {
                valid = violation(context, i, "icon", "must be empty unless the block is a card");
            }
            if (!card && block.ariaLabel() != null && !block.ariaLabel().isEmpty()) {
                valid = violation(context, i, "ariaLabel", "must be empty unless the block is a card");
            }
            if (!"divider".equals(block.type()) && block.dividerStyle() != null
                && !"none".equals(block.dividerStyle())) {
                valid = violation(context, i, "dividerStyle", "must be 'none' unless the block is a divider");
            }
        }
        return valid;
    }

    /** Reported as blocks[i].field; always answers false so a caller can fold it into its result. */
    private static boolean violation(ConstraintValidatorContext context, int index, String field, String message) {
        context.buildConstraintViolationWithTemplate(message)
            .addPropertyNode("blocks")
            .addPropertyNode(field).inIterable().atIndex(index)
            .addConstraintViolation();
        return false;
    }
}
