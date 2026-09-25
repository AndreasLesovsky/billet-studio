package app.billetstudio.billet.controller;

import java.time.temporal.ChronoUnit;
import java.util.List;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.auth.entity.User;
import app.billetstudio.billet.dto.BilletCreateRequest;
import app.billetstudio.billet.dto.BilletDetailDto;
import app.billetstudio.billet.dto.BilletImportRequest;
import app.billetstudio.billet.dto.BilletImportResponse;
import app.billetstudio.billet.dto.BilletSaveRequest;
import app.billetstudio.billet.dto.BilletSaveResponse;
import app.billetstudio.billet.dto.BilletSummaryDto;
import app.billetstudio.billet.dto.PublishRequest;
import app.billetstudio.billet.dto.PublishResponse;
import app.billetstudio.billet.service.BilletService;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The signed-in user's own billets. */
@RestController
@RequestMapping("/v1/billets")
@RequiredArgsConstructor
public class BilletController {

    private final BilletService billetService;

    @GetMapping
    public ResponseEntity<List<BilletSummaryDto>> listBillets(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(billetService.list(user));
    }

    @PostMapping
    @RateLimited(limit = 30, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<BilletDetailDto> createBillet(
        @AuthenticationPrincipal User user,
        @Valid @RequestBody BilletCreateRequest input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(billetService.create(user, input.document()));
    }

    @PostMapping("/import")
    @RateLimited(limit = 5, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<BilletImportResponse> importBillets(
        @AuthenticationPrincipal User user,
        @Valid @RequestBody BilletImportRequest input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(billetService.importDocuments(user, input.documents()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<BilletDetailDto> getBillet(@AuthenticationPrincipal User user, @PathVariable Long id) {
        return ResponseEntity.ok(billetService.get(user, id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<BilletSaveResponse> saveBillet(
        @AuthenticationPrincipal User user,
        @PathVariable Long id,
        @Valid @RequestBody BilletSaveRequest input) {
        return ResponseEntity.ok(billetService.save(user, id, input.version(), input.document()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteBillet(@AuthenticationPrincipal User user, @PathVariable Long id) {
        billetService.delete(user, id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/duplicate")
    @RateLimited(limit = 30, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<BilletDetailDto> duplicateBillet(@AuthenticationPrincipal User user, @PathVariable Long id) {
        return ResponseEntity.status(HttpStatus.CREATED).body(billetService.duplicate(user, id));
    }

    @PostMapping("/{id}/publish")
    @RateLimited(limit = 30, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<PublishResponse> publishBillet(
        @AuthenticationPrincipal User user,
        @PathVariable Long id,
        @Valid @RequestBody PublishRequest input) {
        return ResponseEntity.ok(billetService.publish(user, id, input.version()));
    }

    @PostMapping("/{id}/unpublish")
    public ResponseEntity<Void> unpublishBillet(@AuthenticationPrincipal User user, @PathVariable Long id) {
        billetService.unpublish(user, id);
        return ResponseEntity.noContent().build();
    }
}
