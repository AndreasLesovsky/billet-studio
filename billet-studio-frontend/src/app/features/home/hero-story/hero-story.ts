import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { HeroStoryController } from './hero-story-controller';

/** The 3D loads once the stage is this close to the viewport. */
const NEAR_VIEWPORT = '50% 0px';
/** Without requestIdleCallback (Safari), the load waits this long after the first render. */
const IDLE_FALLBACK_MS = 200;
const IDLE_TIMEOUT_MS = 2000;
const HINT_MS = 4000;

/**
 * The hero's stage: a reserved square in which the canvas fades in over a quiet placeholder once
 * the first 3D frame is drawn, the story's controls and the credit of the gift on it. The 3D loads
 * after the first render, when the browser is idle and the stage is near the viewport; it
 * autoplays once at least half of it is visible (HeroStoryController).
 *
 * Pause/play and replay exist only while an animation does: they are rendered once the 3D is
 * ready, never disabled in its place. This is a deliberate exception to "disabled, not hidden"
 * (CLAUDE.md §20): without WebGL or with a broken story there is no animation to control, and a
 * permanently disabled pair would promise one.
 */
@Component({
  selector: 'app-hero-story',
  imports: [TranslatePipe],
  templateUrl: './hero-story.html',
  styleUrl: './hero-story.scss',
})
export class HeroStory {
  protected readonly controller = inject(HeroStoryController);
  private readonly destroyRef = inject(DestroyRef);
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly toggleButton = viewChild<ElementRef<HTMLButtonElement>>('toggleButton');
  private readonly unavailable = viewChild<ElementRef<HTMLElement>>('unavailable');
  private readonly injector = inject(Injector);

  protected readonly ready = computed(() => this.controller.status() === 'ready');
  protected readonly fallback = computed(() => this.controller.status() === 'fallback');
  /** Until the first 3D frame; never in the fallback, where no frame is coming. */
  protected readonly placeholder = computed(() => !this.ready() && !this.fallback());
  /** Nothing loads until "Play animation": the placeholder stands still. */
  protected readonly still = computed(() => this.controller.status() === 'gated');
  /** The stage as an image with its text alternative; nothing to describe in the fallback. */
  protected readonly figure = computed(() =>
    this.fallback()
      ? null
      : { role: 'img', label: 'HERO.STAGE_LABEL', describedBy: 'hero-story-description' },
  );
  protected readonly startLabel = computed(() =>
    this.controller.starting() ? 'COMMON.LOADING' : 'HERO.PLAY_ANIMATION',
  );
  protected readonly toggleLabel = computed(() =>
    this.controller.playing() ? 'HERO.PAUSE' : 'HERO.PLAY',
  );
  /** "Play animation" was pressed, and the 3D turned out to be unavailable. */
  protected readonly startFailed = signal(false);
  private startRequested = false;
  protected readonly showStart = computed(
    () => this.controller.status() === 'gated' || this.controller.starting(),
  );
  private readonly hintDue = computed(
    () =>
      this.ready() &&
      this.controller.phase() === 'idle' &&
      this.controller.playing() &&
      !this.controller.interacted(),
  );
  private readonly hintExpired = signal(false);
  protected readonly hint = computed(() => this.hintDue() && !this.hintExpired());

  constructor() {
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    // Once per page: the hint fades on its own, or with the first drag.
    effect(() => {
      if (!this.hintDue() || hintTimer !== undefined) return;
      untracked(() => (hintTimer = setTimeout(() => this.hintExpired.set(true), HINT_MS)));
    });
    this.destroyRef.onDestroy(() => clearTimeout(hintTimer));

    // "Play animation" leaves the DOM once the 3D is ready (or unavailable): focus moves on to the
    // pause button, or to the notice that replaced it, instead of falling back to <body>.
    effect(() => {
      const status = this.controller.status();
      if (!this.startRequested || (status !== 'ready' && status !== 'fallback')) return;
      this.startRequested = false;
      untracked(() => {
        if (status === 'fallback') this.startFailed.set(true);
        afterNextRender(
          () => {
            const target = status === 'ready' ? this.toggleButton() : this.unavailable();
            target?.nativeElement.focus();
          },
          { injector: this.injector },
        );
      });
    });

    afterNextRender(() => {
      const container = this.container().nativeElement;
      this.controller.connect(this.canvas().nativeElement, container);
      this.whenIdle(() => this.observe(container));
    });
  }

  protected start(): void {
    this.startRequested = true;
    this.controller.start();
  }

  protected toggle(): void {
    if (this.controller.playing()) this.controller.pause();
    else this.controller.play();
  }

  private whenIdle(run: () => void): void {
    const view = this.view;
    if (!view) return;
    if (typeof view.requestIdleCallback === 'function') {
      const handle = view.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      this.destroyRef.onDestroy(() => view.cancelIdleCallback(handle));
    } else {
      const handle = setTimeout(run, IDLE_FALLBACK_MS);
      this.destroyRef.onDestroy(() => clearTimeout(handle));
    }
  }

  private observe(container: HTMLElement): void {
    if (this.destroyRef.destroyed) return;
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        near.disconnect();
        this.controller.requestLoad();
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    const half = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        this.controller.setHalfVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      },
      { threshold: [0, 0.5] },
    );
    near.observe(container);
    half.observe(container);
    this.destroyRef.onDestroy(() => {
      near.disconnect();
      half.disconnect();
    });
  }
}
