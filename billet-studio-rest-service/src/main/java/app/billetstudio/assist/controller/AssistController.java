package app.billetstudio.assist.controller;

import java.time.temporal.ChronoUnit;

import app.billetstudio.assist.dto.AssistReply;
import app.billetstudio.assist.dto.AssistRequest;
import app.billetstudio.assist.dto.AssistStatusDto;
import app.billetstudio.assist.service.AssistService;
import app.billetstudio.auth.annotation.RateLimited;

import jakarta.validation.Valid;

import lombok.RequiredArgsConstructor;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The billet assistant, for guests and signed-in users alike (docs/assist.md). */
@RestController
@RequestMapping("/v1/assist")
@RequiredArgsConstructor
public class AssistController {

    private final AssistService assistService;

    @GetMapping("/status")
    @RateLimited(limit = 120, duration = 1, unit = ChronoUnit.MINUTES)
    public ResponseEntity<AssistStatusDto> status() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new AssistStatusDto(assistService.status()));
    }

    @PostMapping("/warm-up")
    @RateLimited(limit = 20, duration = 1, unit = ChronoUnit.HOURS)
    public ResponseEntity<Void> warmUp() {
        assistService.warmUp();
        return ResponseEntity.accepted().build();
    }

    @PostMapping
    @RateLimited(config = "app.assist.rate-limit")
    public AssistReply ask(@Valid @RequestBody AssistRequest request) {
        return assistService.ask(request);
    }
}
