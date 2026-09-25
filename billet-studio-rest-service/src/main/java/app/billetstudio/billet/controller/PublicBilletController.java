package app.billetstudio.billet.controller;

import java.time.temporal.ChronoUnit;

import app.billetstudio.auth.annotation.RateLimited;
import app.billetstudio.billet.dto.PublicBilletDto;
import app.billetstudio.billet.service.BilletService;

import lombok.RequiredArgsConstructor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The page behind a share link, for anyone holding the token. no-store, so an unpublish takes effect at once; the
 * X-Robots-Tag header is written for all of /v1/public/** by SecurityConfig.
 */
@RestController
@RequestMapping("/v1/public/billets")
@RequiredArgsConstructor
public class PublicBilletController {

    private final BilletService billetService;

    @GetMapping("/{shareToken}")
    @RateLimited(limit = 120, duration = 1, unit = ChronoUnit.MINUTES)
    public ResponseEntity<PublicBilletDto> getPublicBillet(@PathVariable String shareToken) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(billetService.getPublished(shareToken));
    }
}
