package app.billetstudio.billet.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import app.billetstudio.auth.entity.User;
import app.billetstudio.auth.repository.UserRepository;
import app.billetstudio.auth.validation.LanguageRules;
import app.billetstudio.billet.document.BilletDocument;
import app.billetstudio.billet.document.BilletDocumentCodec;
import app.billetstudio.billet.dto.BilletDetailDto;
import app.billetstudio.billet.dto.BilletImportResponse;
import app.billetstudio.billet.dto.BilletSaveResponse;
import app.billetstudio.billet.dto.BilletSummaryDto;
import app.billetstudio.billet.dto.PublicBilletDto;
import app.billetstudio.billet.dto.PublishResponse;
import app.billetstudio.billet.entity.Billet;
import app.billetstudio.billet.exception.BilletLimitReachedException;
import app.billetstudio.billet.exception.BilletModifiedElsewhereException;
import app.billetstudio.billet.exception.BilletNotFoundException;
import app.billetstudio.billet.exception.InvalidDocumentException;
import app.billetstudio.billet.exception.UnknownModelException;
import app.billetstudio.billet.exception.UnsupportedSchemaVersionException;
import app.billetstudio.billet.repository.BilletRepository;
import app.billetstudio.billet.repository.BilletSummaryRow;
import app.billetstudio.catalog.dto.ModelDto;
import app.billetstudio.catalog.service.ModelCatalogService;
import app.billetstudio.shared.util.SecureTokens;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A user's billets. Every lookup is scoped to the owner, so another user's billet is BILLET_NOT_FOUND, never a 403.
 * Documents are checked in a fixed order: schema version, field and cross-field rules, encoded size, model.
 */
@Slf4j
@Service
public class BilletService {

    /** 128 bits, 22 base64url characters - the width of tbl_billets.share_token. */
    private static final int SHARE_TOKEN_BYTES = 16;
    private static final Pattern SHARE_TOKEN = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final int TITLE_MAX_LENGTH = 120;
    /** Violations listed in the log per rejected document; the rest are counted. */
    private static final int LOGGED_VIOLATIONS = 10;

    private final BilletRepository billetRepository;
    private final UserRepository userRepository;
    private final ModelCatalogService modelCatalogService;
    private final BilletDocumentCodec codec;
    private final Validator validator;
    private final int maxPerUser;

    public BilletService(BilletRepository billetRepository, UserRepository userRepository,
        ModelCatalogService modelCatalogService, BilletDocumentCodec codec, Validator validator,
        @Value("${app.billet.max-per-user}") int maxPerUser) {
        this.billetRepository = billetRepository;
        this.userRepository = userRepository;
        this.modelCatalogService = modelCatalogService;
        this.codec = codec;
        this.validator = validator;
        this.maxPerUser = maxPerUser;
    }

    /** A document that passed every rule, with its normalized JSON. */
    private record CheckedDocument(BilletDocument document, String json) {

        String modelSlug() {
            return Boolean.TRUE.equals(document.scene().enabled()) ? document.scene().modelSlug() : null;
        }
    }

    // ============================================
    // READ
    // ============================================

    @Transactional(readOnly = true)
    public List<BilletSummaryDto> list(User owner) {
        List<BilletSummaryRow> rows = billetRepository.findSummariesByUserId(owner.getId());
        Map<String, String> previews = modelCatalogService.previewUrls(rows.stream()
            .map(BilletSummaryRow::modelSlug)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet()));
        return rows.stream()
            .map(row -> new BilletSummaryDto(row.id(), row.title(), row.theme(), row.modelSlug(),
                previewOf(row.modelSlug(), previews),
                row.published(), Boolean.TRUE.equals(row.hasUnpublishedChanges()), row.shareToken(),
                row.publishedAt(), row.createdAt(), row.updatedAt()))
            .toList();
    }

    @Transactional(readOnly = true)
    public BilletDetailDto get(User owner, Long id) {
        Billet billet = findOwned(owner, id);
        return toDetail(billet, codec.decode(billet.getDocument()), modelOf(billet.getModelSlug()));
    }

    /**
     * The published snapshot behind a share link, with the snapshot's model, never the draft's. A malformed token, an
     * unknown one and an unpublished billet all answer the same BILLET_NOT_FOUND; the format check keeps garbage away
     * from the database.
     */
    @Transactional(readOnly = true)
    public PublicBilletDto getPublished(String shareToken) {
        if (shareToken == null || !SHARE_TOKEN.matcher(shareToken).matches()) {
            throw new BilletNotFoundException();
        }
        Billet billet = billetRepository.findPublishedByShareToken(shareToken)
            .orElseThrow(BilletNotFoundException::new);
        BilletDocument snapshot = codec.decode(billet.getPublishedDocument());
        String modelSlug = Boolean.TRUE.equals(snapshot.scene().enabled()) ? snapshot.scene().modelSlug() : null;
        return new PublicBilletDto(snapshot, modelOf(modelSlug), billet.getPublishedAt());
    }

    // ============================================
    // CREATE
    // ============================================

    @Transactional
    public BilletDetailDto create(User owner, BilletDocument document) {
        CheckedDocument checked = check(document, "document");
        billetRepository.lockOwner(owner.getId());
        ModelDto model = requireModel(checked);
        assertRoomFor(owner, 1);

        Billet billet = billetRepository.save(newBillet(owner, checked));
        log.info("Billet created: id={}, userId={}", billet.getId(), owner.getId());
        return toDetail(billet, checked.document(), model);
    }

    /** A new draft with the same content under the title plus " (Kopie)" / " (copy)"; never published. */
    @Transactional
    public BilletDetailDto duplicate(User owner, Long id) {
        billetRepository.lockOwner(owner.getId());
        Billet source = findOwned(owner, id);
        assertRoomFor(owner, 1);

        BilletDocument original = codec.decode(source.getDocument());
        BilletDocument copy = original.withTitle(copyTitle(original.title(), owner.getPreferredLanguage()));
        CheckedDocument checked = new CheckedDocument(copy, codec.encode(copy));
        Billet billet = billetRepository.save(newBillet(owner, checked));
        log.info("Billet duplicated: id={}, sourceId={}, userId={}", billet.getId(), source.getId(), owner.getId());
        return toDetail(billet, copy, modelOf(billet.getModelSlug()));
    }

    /**
     * All or nothing: every document is checked and the cap counts the whole batch before anything is written. The
     * answer lists the new billets in the order of the documents.
     */
    @Transactional
    public BilletImportResponse importDocuments(User owner, List<BilletDocument> documents) {
        List<CheckedDocument> checked = new ArrayList<>(documents.size());
        for (int i = 0; i < documents.size(); i++) {
            checked.add(check(documents.get(i), "documents[" + i + "]"));
        }
        billetRepository.lockOwner(owner.getId());
        Set<String> slugs = checked.stream()
            .map(CheckedDocument::modelSlug)
            .filter(Objects::nonNull)
            .collect(Collectors.toCollection(HashSet::new));
        Map<String, String> previews = modelCatalogService.previewUrls(slugs);
        slugs.removeAll(previews.keySet());
        if (!slugs.isEmpty()) {
            throw new UnknownModelException("Import names unknown models " + slugs);
        }
        assertRoomFor(owner, checked.size());

        List<Billet> billets = billetRepository.saveAll(checked.stream().map(c -> newBillet(owner, c)).toList());
        log.info("Billets imported: count={}, userId={}", billets.size(), owner.getId());
        return new BilletImportResponse(billets.stream()
            .map(billet -> new BilletSummaryDto(billet.getId(), billet.getTitle(), billet.getTheme(),
                billet.getModelSlug(), previewOf(billet.getModelSlug(), previews), false, false, null, null,
                billet.getCreatedAt(), billet.getUpdatedAt()))
            .toList());
    }

    // ============================================
    // UPDATE
    // ============================================

    /**
     * Autosave. The request version is compared explicitly first; @Version then catches a save that committed between
     * that comparison and this UPDATE. An unchanged document writes nothing and keeps version and updatedAt.
     */
    @Transactional
    public BilletSaveResponse save(User owner, Long id, Long version, BilletDocument document) {
        Billet billet = findOwned(owner, id);
        assertVersion(billet, version);
        CheckedDocument checked = check(document, "document");
        requireModel(checked);

        copyDocument(billet, checked);
        flush(billet);
        return new BilletSaveResponse(billet.getVersion(), billet.getUpdatedAt(), billet.hasUnpublishedChanges());
    }

    /**
     * The snapshot becomes the current draft, exactly as of the version the user saw. The share token is minted on
     * the first publish and kept from then on, so a republish restores the same link.
     *
     * The row lock is mandatory: publishing keeps the version, so without it two parallel first publishes would each
     * mint a token and the later commit would overwrite the one the earlier had already handed out.
     */
    @Transactional
    public PublishResponse publish(User owner, Long id, Long version) {
        Billet billet = billetRepository.findOwnedForUpdate(id, owner.getId())
            .orElseThrow(BilletNotFoundException::new);
        assertVersion(billet, version);

        billet.setPublishedDocument(billet.getDocument());
        billet.setPublishedAt(Billet.now());
        if (billet.getShareToken() == null) {
            billet.setShareToken(SecureTokens.urlSafeToken(SHARE_TOKEN_BYTES));
        }
        flush(billet);
        log.info("Billet published: id={}, userId={}", billet.getId(), owner.getId());
        return new PublishResponse(billet.getShareToken(), billet.getPublishedAt(), billet.getVersion());
    }

    /** Clears the snapshot and keeps the token. Idempotent, and independent of the draft version. */
    @Transactional
    public void unpublish(User owner, Long id) {
        if (billetRepository.unpublish(id, owner.getId(), Billet.now()) == 0) {
            throw new BilletNotFoundException();
        }
        log.info("Billet unpublished: id={}, userId={}", id, owner.getId());
    }

    // ============================================
    // DELETE
    // ============================================

    @Transactional
    public void delete(User owner, Long id) {
        if (billetRepository.deleteOwned(id, owner.getId()) == 0) {
            throw new BilletNotFoundException();
        }
        log.info("Billet deleted: id={}, userId={}", id, owner.getId());
    }

    // ============================================
    // HELPERS
    // ============================================

    private Billet findOwned(User owner, Long id) {
        return billetRepository.findByIdAndUserId(id, owner.getId()).orElseThrow(BilletNotFoundException::new);
    }

    private static void assertVersion(Billet billet, Long version) {
        if (!billet.getVersion().equals(version)) {
            throw new BilletModifiedElsewhereException();
        }
    }

    private void flush(Billet billet) {
        try {
            billetRepository.saveAndFlush(billet);
        } catch (OptimisticLockingFailureException e) {
            throw new BilletModifiedElsewhereException();
        }
    }

    private void assertRoomFor(User owner, int adding) {
        long count = billetRepository.countByUserId(owner.getId());
        if (count + adding > maxPerUser) {
            throw new BilletLimitReachedException(
                "userId=" + owner.getId() + " has " + count + ", adding " + adding + ", limit " + maxPerUser);
        }
    }

    /**
     * Schema version before anything else: a document of another version is expected to fail the field rules too,
     * and the client has to learn that it is out of date, not that a field is wrong.
     */
    private CheckedDocument check(BilletDocument document, String label) {
        if (document == null) {
            throw new InvalidDocumentException(label + " is missing");
        }
        Integer schemaVersion = document.schemaVersion();
        if (schemaVersion != null && schemaVersion != BilletDocument.CURRENT_SCHEMA_VERSION) {
            throw new UnsupportedSchemaVersionException(label + ".schemaVersion=" + schemaVersion);
        }
        Set<ConstraintViolation<BilletDocument>> violations = validator.validate(document);
        if (!violations.isEmpty()) {
            throw new InvalidDocumentException(label + ": " + describe(violations));
        }
        return new CheckedDocument(document, codec.encode(document));
    }

    /** Paths and constraint messages only - the rejected values are user content and stay out of the log. */
    private static String describe(Set<ConstraintViolation<BilletDocument>> violations) {
        List<String> lines = violations.stream()
            .map(violation -> violation.getPropertyPath() + " " + violation.getMessage())
            .sorted(Comparator.naturalOrder())
            .toList();
        String listed = String.join("; ", lines.subList(0, Math.min(lines.size(), LOGGED_VIOLATIONS)));
        return lines.size() > LOGGED_VIOLATIONS
            ? listed + "; +" + (lines.size() - LOGGED_VIOLATIONS) + " more"
            : listed;
    }

    /** The model of an enabled scene; it must exist (inactive is fine). */
    private ModelDto requireModel(CheckedDocument checked) {
        String slug = checked.modelSlug();
        if (slug == null) {
            return null;
        }
        return modelCatalogService.find(slug).orElseThrow(() -> new UnknownModelException("Unknown model " + slug));
    }

    private ModelDto modelOf(String slug) {
        return Optional.ofNullable(slug).flatMap(modelCatalogService::find).orElse(null);
    }

    private static String previewOf(String slug, Map<String, String> previews) {
        return slug != null ? previews.get(slug) : null;
    }

    private Billet newBillet(User owner, CheckedDocument checked) {
        Billet billet = new Billet();
        billet.setUser(userRepository.getReferenceById(owner.getId()));
        copyDocument(billet, checked);
        return billet;
    }

    /** The draft and the columns the list reads instead of it. */
    private static void copyDocument(Billet billet, CheckedDocument checked) {
        billet.setDocument(checked.json());
        billet.setTitle(checked.document().title());
        billet.setTheme(checked.document().theme());
        billet.setModelSlug(checked.modelSlug());
    }

    private static BilletDetailDto toDetail(Billet billet, BilletDocument document, ModelDto model) {
        return new BilletDetailDto(billet.getId(), billet.getVersion(), document, model, billet.isPublished(),
            billet.hasUnpublishedChanges(), billet.getShareToken(), billet.getPublishedAt(), billet.getCreatedAt(),
            billet.getUpdatedAt());
    }

    /**
     * Title plus the suffix in the user's language, the title shortened so the result stays within 120 characters.
     * The cut never splits a surrogate pair.
     */
    static String copyTitle(String title, String preferredLanguage) {
        String suffix = "en".equals(LanguageRules.orDefault(preferredLanguage)) ? " (copy)" : " (Kopie)";
        int room = TITLE_MAX_LENGTH - suffix.length();
        String base = title;
        if (base.length() > room) {
            int cut = Character.isHighSurrogate(base.charAt(room - 1)) ? room - 1 : room;
            base = base.substring(0, cut).stripTrailing();
        }
        return base + suffix;
    }
}
