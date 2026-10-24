package app.billetstudio.billet.controller;

import app.billetstudio.billet.dto.AdminBilletDto;
import app.billetstudio.billet.service.AdminBilletService;
import app.billetstudio.shared.dto.PageDto;

import lombok.RequiredArgsConstructor;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only overview of every user's billets for administrators; there is no detail or write endpoint here. */
@RestController
@RequestMapping("/v1/admin/billets")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminBilletController {

    private final AdminBilletService adminBilletService;

    /**
     * One page of billets. q matches the title or the owner's name or email; published filters by state (empty =
     * both); sort is "field[,asc|desc]" over title, owner, createdAt, updatedAt, publishedAt. size must be
     * 1..{@link AdminBilletService#MAX_PAGE_SIZE} and page >= 0; anything else is VALIDATION_ERROR.
     */
    @GetMapping
    public ResponseEntity<PageDto<AdminBilletDto>> listBillets(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String q,
        @RequestParam(required = false) Boolean published,
        @RequestParam(required = false) String sort) {
        return ResponseEntity.ok(adminBilletService.list(page, size, q, published, sort));
    }
}
