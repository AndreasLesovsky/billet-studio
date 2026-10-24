package app.billetstudio.billet.service;

import java.util.Locale;
import java.util.Map;

import app.billetstudio.auth.exception.ValidationException;
import app.billetstudio.billet.dto.AdminBilletDto;
import app.billetstudio.billet.repository.AdminBilletRow;
import app.billetstudio.billet.repository.BilletRepository;
import app.billetstudio.shared.dto.PageDto;

import lombok.RequiredArgsConstructor;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The read-only admin overview of every user's billets (paging, search and sort like the admin user list). */
@Service
@RequiredArgsConstructor
public class AdminBilletService {

    public static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Direction.DESC, "updatedAt", "id");
    /** API sort field -> entity path; any other field is a VALIDATION_ERROR. */
    private static final Map<String, String> SORT_FIELDS = Map.of(
        "title", "title",
        "owner", "user.name",
        "createdAt", "createdAt",
        "updatedAt", "updatedAt",
        "publishedAt", "publishedAt");

    private final BilletRepository billetRepository;

    /**
     * One page of billets. q matches the title or the owner's name or email; published filters by state (null =
     * both); sort is "field[,asc|desc]" over {@link #SORT_FIELDS}, defaulting to the most recently changed first.
     */
    @Transactional(readOnly = true)
    public PageDto<AdminBilletDto> list(int page, int size, String q, Boolean published, String sort) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ValidationException("Page out of range: page=" + page + ", size=" + size);
        }
        PageRequest pageable = PageRequest.of(page, size, parseSort(sort));
        return PageDto.of(billetRepository.searchAdmin(likePattern(q), published, pageable),
            AdminBilletService::toDto);
    }

    private static AdminBilletDto toDto(AdminBilletRow row) {
        boolean published = row.published();
        return new AdminBilletDto(row.id(), row.title(), row.theme(), row.modelSlug(), published,
            published ? row.shareToken() : null, row.publishedAt(), row.createdAt(), row.updatedAt(),
            new AdminBilletDto.Owner(row.ownerId(), row.ownerName(), row.ownerEmail(),
                Boolean.TRUE.equals(row.ownerActive())));
    }

    private static Sort parseSort(String sort) {
        if (!hasText(sort)) {
            return DEFAULT_SORT;
        }
        String[] parts = sort.split(",");
        String property = SORT_FIELDS.get(parts[0].trim());
        Sort.Direction direction = parts.length == 2
            ? Sort.Direction.fromOptionalString(parts[1].trim()).orElse(null)
            : parts.length == 1 ? Sort.Direction.ASC : null;
        if (property == null || direction == null) {
            throw new ValidationException("Invalid sort: " + sort);
        }
        // id as tie-breaker: without a unique last key, rows with equal values can repeat across pages.
        return Sort.by(direction, property).and(Sort.by(direction, "id"));
    }

    /** Lowercased substring pattern with '!' as the LIKE escape, or null when there is no text filter. */
    private static String likePattern(String q) {
        if (!hasText(q)) {
            return null;
        }
        String trimmed = q.trim();
        if (trimmed.length() > MAX_QUERY_LENGTH) {
            throw new ValidationException("Search query too long");
        }
        String escaped = trimmed.toLowerCase(Locale.ROOT)
            .replace("!", "!!")
            .replace("%", "!%")
            .replace("_", "!_");
        return "%" + escaped + "%";
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
