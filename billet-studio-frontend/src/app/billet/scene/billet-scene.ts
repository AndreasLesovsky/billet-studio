import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  input,
  isDevMode,
  output,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { ModelAssetDto } from '../../core/models/models';
import { LanguageService } from '../../core/services/language-service';
import type { ColorMode } from '../../core/theme/theme-registry.generated';
import type { BilletDocument } from '../billet-document';
import { mediaQuery, PREFERS_REDUCED_MOTION, prefersSaveData } from '../view/media-query';
import { AssetCache } from './asset-cache';
import { loadFraction, sameStageSettings, type StageSettings, type WheelZoom } from './scene-math';
import type { SceneStage } from './scene-stage';
import { ThreeRuntime } from './three-runtime';

type SceneStatus = 'empty' | 'gated' | 'loading' | 'ready' | 'error';

/** How long the zoom hint stays before it fades. */
const ZOOM_HINT_MS = 1500;

/**
 * The billet's 3D scene. Until the model is drawn, the model's preview image stands in; it is
 * rendered with the scene's camera (tools/asset-pipeline/models/preview.html), so it sits where the
 * model appears. On a data-saver connection the 3D waits for a tap unless `eager`; a failed load
 * keeps the preview. The host fills its parent, which sets the height (`scene.height`).
 *
 * With `wheelZoom` 'modifier' the first plain wheel over the shown model says, once, how to zoom.
 */
@Component({
  selector: 'app-billet-scene',
  imports: [TranslatePipe],
  templateUrl: './billet-scene.html',
  styleUrl: './billet-scene.scss',
  host: {
    '[class.billet-scene--static]': '!interactive()',
    '[style.color-scheme]': 'mode()',
  },
})
export class BilletScene {
  readonly scene = input.required<BilletDocument['scene']>();
  readonly model = input<ModelAssetDto | null>(null);
  readonly mode = input<ColorMode>('light');
  readonly interactive = input(true);
  /** Loads the 3D model even on a data-saver connection. */
  readonly eager = input(false);
  /** How much a CSS transform magnifies the scene; the canvas renders sharper to match. */
  readonly magnification = input(1);
  readonly wheelZoom = input<WheelZoom>('modifier');
  /** The model is drawn in 3D. */
  readonly loaded = output<void>();

  private readonly runtime = inject(ThreeRuntime);
  private readonly assets = inject(AssetCache);
  private readonly destroyRef = inject(DestroyRef);
  private readonly language = inject(LanguageService);
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly saveData = prefersSaveData(this.view);
  private readonly reducedMotion = mediaQuery(PREFERS_REDUCED_MOTION);
  private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly stage = signal<SceneStage | null>(null);
  private readonly bootFailed = signal(false);
  private readonly loadRequested = signal(false);
  private booting = false;
  private errorLogged = false;
  private zoomHinted = false;
  private zoomHintTimer: ReturnType<typeof setTimeout> | undefined;

  /** The loading UI is site text inside a billet that may be in the other language. */
  protected readonly uiLang = this.language.currentLang;
  protected readonly progress = signal<number | null>(null);
  protected readonly percent = computed(() => {
    const progress = this.progress();
    return progress === null ? null : Math.round(progress * 100);
  });
  protected readonly zoomHint = signal(false);
  protected readonly zoomHintKey = isApple(this.view)
    ? 'BILLET_SCENE.ZOOM_HINT_APPLE'
    : 'BILLET_SCENE.ZOOM_HINT';
  protected readonly previewUrl = computed(() => this.model()?.previewUrl || null);
  protected readonly sizeLabel = computed(() =>
    megabytes(this.model()?.fileSizeBytes ?? 0, this.language.locale()),
  );
  private readonly modelUrl = computed(() => this.model()?.fileUrl || null);
  private readonly settings = computed<StageSettings>(() => this.scene(), {
    equal: sameStageSettings,
  });
  private readonly gated = computed(() => this.saveData && !this.eager() && !this.loadRequested());

  /** The shown model: swapped on the one stage whenever the URL changes. */
  private readonly shown = resource({
    params: () => {
      const stage = this.stage();
      return stage ? { stage, url: this.modelUrl() } : undefined;
    },
    loader: ({ params, abortSignal }) => this.show(params.stage, params.url, abortSignal),
  });

  protected readonly status = computed<SceneStatus>(() => {
    if (!this.modelUrl()) return 'empty';
    if (this.gated()) return 'gated';
    if (this.bootFailed()) return 'error';
    switch (this.shown.status()) {
      case 'resolved':
        return 'ready';
      case 'error':
        return 'error';
      default:
        return 'loading';
    }
  });

  constructor() {
    afterNextRender(() => {
      if (!this.gated()) void this.boot();
    });
    // Applied to the live stage: the editor's sliders never recreate the renderer.
    effect(() => this.onStage((stage) => stage.applySettings(this.settings())));
    effect(() => this.onStage((stage) => stage.setInteractive(this.interactive())));
    effect(() => this.onStage((stage) => stage.setReducedMotion(this.reducedMotion())));
    effect(() => this.onStage((stage) => stage.setMagnification(this.magnification())));
    effect(() => this.onStage((stage) => stage.setWheelZoom(this.wheelZoom())));
    this.destroyRef.onDestroy(() => clearTimeout(this.zoomHintTimer));
  }

  private onStage(apply: (stage: SceneStage) => void): void {
    const stage = this.stage();
    if (stage) apply(stage);
  }

  protected loadNow(): void {
    this.loadRequested.set(true);
    void this.boot();
  }

  private async boot(): Promise<void> {
    if (this.booting) return;
    this.booting = true;
    try {
      const { SceneStage } = await this.runtime.load();
      // Destroyed while the chunk loaded: never create a context nobody would dispose.
      if (this.destroyRef.destroyed) return;
      const stage = new SceneStage({
        canvas: this.canvas().nativeElement,
        container: this.container().nativeElement,
        settings: this.settings(),
        interactive: this.interactive(),
        reducedMotion: this.reducedMotion(),
        wheelZoom: this.wheelZoom(),
        onPlainWheel: () => this.hintZoom(),
        debug: isDevMode(),
      });
      this.destroyRef.onDestroy(() => stage.dispose());
      this.stage.set(stage);
    } catch (error) {
      this.bootFailed.set(true);
      this.logOnce(error);
    }
  }

  /** Resolves once the model is drawn; an aborted call (newer URL, destroyed) never emits. */
  private async show(
    stage: SceneStage,
    url: string | null,
    abortSignal: AbortSignal,
  ): Promise<void> {
    stage.clear();
    if (!url) return;
    this.progress.set(null);
    const expectedBytes = untracked(this.model)?.fileSizeBytes ?? 0;
    try {
      const instance = await this.assets.instantiate(url, {
        signal: abortSignal,
        onProgress: ({ loaded, total }) =>
          this.progress.set(loadFraction(loaded, total, expectedBytes)),
      });
      // Superseded right as the load finished: the newer call owns the stage now.
      if (abortSignal.aborted) {
        instance.release();
        return;
      }
      await stage.show(instance);
    } catch (error) {
      if (!abortSignal.aborted) this.logOnce(error);
      throw error;
    }
    if (!abortSignal.aborted) this.loaded.emit();
  }

  /** Once per scene, and only over a drawn model: there is nothing to zoom before. */
  private hintZoom(): void {
    if (this.zoomHinted || this.status() !== 'ready') return;
    this.zoomHinted = true;
    this.zoomHint.set(true);
    this.zoomHintTimer = setTimeout(() => this.zoomHint.set(false), ZOOM_HINT_MS);
  }

  /** The preview stays up on failure; no toast, one console line per scene. */
  private logOnce(error: unknown): void {
    if (this.errorLogged) return;
    this.errorLogged = true;
    console.warn('Billet scene: 3D unavailable, keeping the preview image.', error);
  }
}

/** macOS and iOS/iPadOS (an iPad reports itself as a Mac), where the zoom key is ⌘. */
function isApple(view: Window | null): boolean {
  const navigator = view?.navigator as
    (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  return /mac|iphone|ipad|ipod/i.test(
    navigator?.userAgentData?.platform || navigator?.platform || '',
  );
}

function megabytes(bytes: number, locale: string): string {
  if (bytes <= 0) return '';
  const format = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 1,
  });
  return format.format(bytes / 1_000_000);
}
