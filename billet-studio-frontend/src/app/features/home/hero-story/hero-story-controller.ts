import {
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Injectable,
  InjectionToken,
  isDevMode,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';

import { AssetCache } from '../../../billet/scene/asset-cache';
import type { TemplateId } from '../../../billet/templates/templates';
import {
  FINE_HOVER,
  mediaQuery,
  PREFERS_REDUCED_MOTION,
  prefersSaveData,
} from '../../../billet/view/media-query';
import { LanguageService } from '../../../core/services/language-service';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { splitCredit } from '../../../core/utils/asset-credit';
import type { HeroLang, HeroMode } from './hero-assets.generated';
import { HERO_HOME } from './hero-home.generated';
import { HeroRuntime } from './hero-runtime';
import type { HeroStage, HeroStageOptions, HeroStageState, HeroVariant } from './hero-stage';
import type { HeroPhase } from './hero-timeline';

/**
 * - `waiting`: the 3D loads once the stage is near the viewport;
 * - `gated`: reduced motion or a data saver: nothing loads until "Play animation";
 * - `loading`, `ready`;
 * - `fallback`: no story, no WebGL or a failed load: the chapters stand alone, no controls.
 */
type HeroStatus = 'waiting' | 'gated' | 'loading' | 'ready' | 'fallback';

/** The dev page's inspection switches (/dev/hero?t&lang&mode&debug&capture). */
export interface HeroStoryOptions {
  /** Another story GLB, e.g. a raw Blender export under test. */
  readonly storyUrl?: string;
  /** A fixed story time, paused; 'end' is the idle pose. */
  readonly time?: number | 'end';
  readonly lang?: HeroLang;
  readonly mode?: HeroMode;
  /** three's shader diagnostics. */
  readonly debug?: boolean;
  /** Keeps the drawn frame readable for a poster capture. */
  readonly capture?: boolean;
}

export const HERO_STORY_OPTIONS = new InjectionToken<HeroStoryOptions>('HERO_STORY_OPTIONS', {
  factory: () => ({}),
});

/** The canvas and the element whose size it fills. */
interface StageHost {
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;
}

/** Set once the story autoplayed in this browser session; later visits start in the idle phase. */
const SEEN_STORAGE_KEY = 'billet-studio.hero-story-seen';

/**
 * The home page hero's state and commands, shared by the stage and the chapters (provided by the
 * page). Its signals change only when their value does; the 3D itself lives in the lazy hero chunk
 * (HeroRuntime → HeroStage).
 */
@Injectable()
export class HeroStoryController {
  private readonly heroRuntime = inject(HeroRuntime);
  private readonly assets = inject(AssetCache);
  private readonly language = inject(LanguageService);
  private readonly colorMode = inject(ColorModeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly options = inject(HERO_STORY_OPTIONS);
  private readonly reducedMotion = mediaQuery(PREFERS_REDUCED_MOTION);
  private readonly fineHover = mediaQuery(FINE_HOVER);
  private readonly saveData = prefersSaveData(this.view);

  private readonly storyUrl = this.options.storyUrl ?? HERO_HOME.storyUrl;
  /** A story GLB is built; without it the page shows the chapters only. */
  readonly available = this.storyUrl !== null;

  private readonly statusState = signal<HeroStatus>(this.initialStatus());
  private readonly beatState = signal(0);
  private readonly playingState = signal(false);
  private readonly phaseState = signal<HeroPhase>('story');
  private readonly occasionState = signal<TemplateId>('valentinstag');
  private readonly startingState = signal(false);
  private readonly interactedState = signal(false);

  readonly status = this.statusState.asReadonly();
  readonly beat = this.beatState.asReadonly();
  readonly playing = this.playingState.asReadonly();
  readonly phase = this.phaseState.asReadonly();
  readonly occasion = this.occasionState.asReadonly();
  /** "Play animation" was pressed and the 3D is loading. */
  readonly starting = this.startingState.asReadonly();
  /** The gift was dragged or tapped (the drag hint's work is done). */
  readonly interacted = this.interactedState.asReadonly();
  /** The attribution of the gift on the stage; CC-BY requires it wherever the model shows. */
  readonly credit = computed(() =>
    this.status() === 'ready' ? splitCredit(HERO_HOME.credits[this.occasion()]) : null,
  );

  private readonly stage = signal<HeroStage | null>(null);
  private readonly variant = computed<HeroVariant>(
    () => ({
      lang: this.options.lang ?? this.language.currentLang(),
      mode: this.options.mode ?? this.colorMode.resolvedMode(),
    }),
    { equal: (a, b) => a.lang === b.lang && a.mode === b.mode },
  );
  private host: StageHost | null = null;
  private booting = false;
  private halfVisible = false;
  private autoplayPending = false;
  private playAfterLoad = false;
  private pendingSeek: number | null = null;
  private errorLogged = false;

  constructor() {
    effect(() => {
      const stage = this.stage();
      stage?.setVariant(this.variant());
    });
    effect(() => {
      const stage = this.stage();
      stage?.setParallax(this.fineHover() && !this.reducedMotion());
    });
    // Reduced motion switched on mid-story: straight to the end, still.
    effect(() => {
      if (!this.reducedMotion()) return;
      untracked(() => {
        this.autoplayPending = false;
        if (this.playingState()) this.stage()?.settle(false);
      });
    });
  }

  /** The stage's canvas and the element it fills; the 3D boots into them. */
  connect(canvas: HTMLCanvasElement, container: HTMLElement): void {
    this.host = { canvas, container };
  }

  /** The stage came near the viewport after the page settled: load, unless gated. */
  requestLoad(): void {
    if (this.status() === 'waiting') void this.boot();
  }

  /** At least half the stage is visible: the story may autoplay. */
  setHalfVisible(visible: boolean): void {
    this.halfVisible = visible;
    this.maybeAutoplay();
  }

  /** "Play animation" (reduced motion, data saver): loads the 3D and plays the story. */
  start(): void {
    if (this.status() !== 'gated') return;
    this.playAfterLoad = true;
    this.startingState.set(true);
    void this.boot();
  }

  play(): void {
    this.stage()?.play();
  }

  pause(): void {
    const stage = this.stage();
    stage?.pause();
  }

  replay(): void {
    this.markSeen();
    this.stage()?.replay();
  }

  /**
   * A chapter: jumps to its beat, loading the 3D first when it is not there yet. Before the story
   * ever played it plays from there (unless reduced motion); a paused story stays paused. A stage
   * mostly out of view (phones: below the chapters) is scrolled in, so the click shows something.
   */
  seekBeat(index: number): void {
    if (this.status() === 'fallback') return;
    this.revealStage();
    const stage = this.stage();
    if (stage && this.status() === 'ready') {
      const firstPlay = this.autoplayPending;
      this.autoplayPending = false;
      stage.seekBeat(index);
      if (firstPlay && !this.reducedMotion()) this.playFromHere(stage);
      return;
    }
    this.pendingSeek = index;
    void this.boot();
  }

  /** GPU resources of the stage (dev page). */
  memory(): ReturnType<HeroStage['memory']> | null {
    const stage = this.stage();
    return stage ? stage.memory() : null;
  }

  private initialStatus(): HeroStatus {
    if (!this.available) return 'fallback';
    if (this.options.time !== undefined) return 'waiting';
    return this.reducedMotion() || this.saveData ? 'gated' : 'waiting';
  }

  private async boot(): Promise<void> {
    const host = this.host;
    const storyUrl = this.storyUrl;
    if (this.booting || this.stage() || !host || !storyUrl) return;
    this.booting = true;
    this.statusState.set('loading');
    try {
      await this.bootStage(host, storyUrl);
    } catch (error) {
      if (!this.destroyRef.destroyed) this.fail(error);
    } finally {
      this.booting = false;
      this.startingState.set(false);
    }
  }

  private async bootStage(host: StageHost, storyUrl: string): Promise<void> {
    const { HeroStage } = await this.heroRuntime.load();
    // Destroyed while the chunk loaded: never create a context nobody would dispose.
    if (this.destroyRef.destroyed) return;
    const stage = new HeroStage(this.stageOptions(host, storyUrl));
    this.destroyRef.onDestroy(() => stage.dispose());
    this.stage.set(stage);
    await stage.load();
    if (this.stage() !== stage) return;
    this.begin(stage);
    // A start past gates.screens (dev time, a later visit, a chapter) shows no black display.
    if (stage.needsScreens()) await stage.screensReady();
    if (this.stage() !== stage) return;
    this.statusState.set('ready');
    this.maybeAutoplay();
  }

  private stageOptions(host: StageHost, storyUrl: string): HeroStageOptions {
    return {
      ...host,
      assets: this.assets,
      storyUrl,
      variant: this.variant(),
      saveData: this.saveData,
      debug: isDevMode() && !!this.options.debug,
      preserveDrawingBuffer: !!this.options.capture,
      onState: (state) => this.onState(state),
      onInteract: () => this.interactedState.set(true),
      onError: (error) => this.fail(error),
    };
  }

  /**
   * Where the loaded story starts: a dev time, a chapter (played from there unless reduced motion
   * holds it still), "Play animation", the idle phase of a later visit, or the story waiting for
   * autoplay.
   */
  private begin(stage: HeroStage): void {
    const { time } = this.options;
    if (time !== undefined) {
      stage.seekTime(time === 'end' ? Number.POSITIVE_INFINITY : time);
    } else if (this.pendingSeek !== null) {
      stage.seekBeat(this.pendingSeek);
      if (this.playAfterLoad || !this.reducedMotion()) this.playFromHere(stage);
    } else if (this.playAfterLoad) {
      this.markSeen();
      stage.replay();
    } else if (readSeen()) {
      stage.settle(!this.reducedMotion());
    } else {
      this.autoplayPending = true;
    }
    this.pendingSeek = null;
  }

  private playFromHere(stage: HeroStage): void {
    this.markSeen();
    stage.play();
  }

  /** Brings a stage that is less than half visible into view. */
  private revealStage(): void {
    if (this.halfVisible || !this.host) return;
    this.host.container.scrollIntoView({
      block: 'nearest',
      behavior: this.reducedMotion() ? 'auto' : 'smooth',
    });
  }

  private maybeAutoplay(): void {
    const stage = this.stage();
    if (!this.autoplayPending || !this.halfVisible || this.status() !== 'ready' || !stage) return;
    if (this.reducedMotion()) return;
    this.autoplayPending = false;
    this.markSeen();
    stage.play();
  }

  private onState(state: HeroStageState): void {
    const enteredIdle = state.phase === 'idle' && this.phaseState() === 'story';
    setIfChanged(this.beatState, state.beat);
    setIfChanged(this.playingState, state.playing);
    setIfChanged(this.phaseState, state.phase);
    setIfChanged(this.occasionState, state.occasion);
    // A story played on request under reduced motion ends still; the idle cycle waits for Play.
    if (enteredIdle && state.playing && this.reducedMotion()) this.stage()?.pause();
  }

  /** The 3D stays away: no WebGL, a broken or missing story. One console line, no toast. */
  private fail(error: unknown): void {
    this.stage()?.dispose();
    this.stage.set(null);
    this.statusState.set('fallback');
    if (this.errorLogged) return;
    this.errorLogged = true;
    console.warn('Hero story: 3D unavailable, showing the chapters only.', error);
  }

  private markSeen(): void {
    try {
      sessionStorage.setItem(SEEN_STORAGE_KEY, '1');
    } catch {
      // Storage blocked: the story plays again on the next visit.
    }
  }
}

function readSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setIfChanged<T>(target: WritableSignal<T>, value: T): void {
  if (!Object.is(target(), value)) target.set(value);
}
