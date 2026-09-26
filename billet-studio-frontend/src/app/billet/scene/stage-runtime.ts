import {
  ACESFilmicToneMapping,
  type Camera,
  type Object3D,
  SRGBColorSpace,
  type ToneMapping,
  WebGLRenderer,
} from 'three';

import { frameSeconds } from './scene-math';

const MAX_PIXEL_RATIO = 2;

export interface StageRuntimeOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; observed for size and visibility. */
  readonly container: HTMLElement;
  /** three's shader diagnostics; they force synchronous shader compiles, so dev builds only. */
  readonly debug: boolean;
  readonly exposure: number;
  /** The tone curve; ACES Filmic (the original card's) unless the owner needs another. */
  readonly toneMapping?: ToneMapping;
  /** Keeps the drawn frame readable after compositing (a poster capture); costs a buffer copy. */
  readonly preserveDrawingBuffer?: boolean;
  /** Advances the owner's state; true when the picture changed and has to be drawn. */
  readonly update: (seconds: number) => boolean;
  /** Draws the owner's scene, e.g. `runtime.renderer.render(scene, camera)`. */
  readonly draw: () => void;
  /**
   * Something moves on its own (auto-rotation, an animation, a playing story): while true the
   * loop keeps running. Read only on each frame and on `invalidate`, so a stopped loop does not
   * start by itself: call `invalidate` when it turns true.
   */
  readonly hasMotion: () => boolean;
  /** The canvas got a new non-zero size; a frame is drawn right after. */
  readonly onResize: (width: number, height: number) => void;
  /** The GPU context is back; rebuild what three cannot restore (a baked environment). */
  readonly onContextRestored: () => void;
  /** Frees the owner's GPU resources, after the loop stopped and before the renderer goes. */
  readonly releaseScene: () => void;
}

/**
 * The generic part of a stage: one WebGL renderer and its context, sized to its container, and a
 * render-on-demand loop that runs only while something moves or a frame is pending and the
 * canvas is on screen in a visible tab. The owner keeps camera, content and controls; `start`
 * once they exist.
 */
export class StageRuntime {
  readonly renderer: WebGLRenderer;
  private readonly options: StageRuntimeOptions;
  private readonly listeners = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly visibilityObserver: IntersectionObserver;
  private magnification = 1;
  private width = 0;
  private height = 0;
  private onScreen = false;
  private contextLost = false;
  private running = false;
  private needsRender = true;
  private lastFrame: number | null = null;
  private isDisposed = false;

  constructor(options: StageRuntimeOptions) {
    this.options = options;
    // Throws when WebGL is unavailable - before anything else exists that would need disposing.
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.debug.checkShaderErrors = options.debug;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = options.toneMapping ?? ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure;

    const signal = this.listeners.signal;
    options.canvas.addEventListener('webglcontextlost', (event) => this.loseContext(event), {
      signal,
    });
    options.canvas.addEventListener('webglcontextrestored', () => this.restoreContext(), {
      signal,
    });
    document.addEventListener('visibilitychange', () => this.invalidate(), { signal });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.onScreen = entries[entries.length - 1].isIntersecting;
      this.invalidate();
    });
  }

  /** Aborted on `dispose`: the owner registers its own DOM listeners with it. */
  get signal(): AbortSignal {
    return this.listeners.signal;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Observes the container and draws the first frame; call once the owner's scene is set up. */
  start(): void {
    this.resizeObserver.observe(this.options.container);
    this.visibilityObserver.observe(this.options.container);
    this.resize();
  }

  /** Requests a frame; bound, so it can be an event listener. */
  readonly invalidate = (): void => {
    this.needsRender = true;
    this.syncLoop();
  };

  /** Draws synchronously, e.g. right after a resize cleared the drawing buffer. */
  renderNow(): void {
    if (!this.contextLost && this.width > 0 && this.height > 0) this.draw();
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  /**
   * The canvas is shown magnified by a CSS transform (the editor's preview zoom): it renders that
   * many more pixels, up to MAX_PIXEL_RATIO, so the model stays sharp. A shrunk canvas keeps its
   * device pixel ratio.
   */
  setMagnification(magnification: number): void {
    this.magnification = Math.max(1, magnification);
    this.resize();
  }

  /** Compiles the scene's shaders ahead of the first frame, in parallel where the GPU can. */
  async compile(scene: Object3D, camera: Camera): Promise<void> {
    try {
      // compileAsync looks the extension up with get(), which warns where it is missing (Firefox).
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
        await this.renderer.compileAsync(scene, camera);
      } else {
        this.renderer.compile(scene, camera);
      }
    } catch {
      // The first render compiles instead.
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.stopLoop();
    this.listeners.abort();
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    this.options.releaseScene();
    this.renderer.dispose();
    // Frees the GPU context now instead of at garbage collection, so remounting a stage never
    // stacks contexts.
    this.renderer.forceContextLoss();
  }

  private readonly frame = (time: number): void => {
    const seconds = frameSeconds(this.lastFrame, time);
    this.lastFrame = time;
    if (this.options.update(seconds) || this.needsRender) this.draw();
    else if (!this.options.hasMotion()) this.stopLoop();
  };

  private draw(): void {
    this.needsRender = false;
    this.options.draw();
  }

  private syncLoop(): void {
    const canRun =
      !this.isDisposed &&
      !this.contextLost &&
      this.onScreen &&
      document.visibilityState === 'visible' &&
      this.width > 0 &&
      this.height > 0;
    if (!canRun) this.stopLoop();
    else if (this.needsRender || this.options.hasMotion()) this.startLoop();
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = null;
    this.renderer.setAnimationLoop(this.frame);
  }

  private stopLoop(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.options.container;
    const ratio = Math.min(devicePixelRatio * this.magnification, MAX_PIXEL_RATIO);
    if (width === this.width && height === this.height && ratio === this.renderer.getPixelRatio()) {
      return;
    }
    this.width = width;
    this.height = height;
    if (width > 0 && height > 0) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      this.options.onResize(width, height);
      this.renderNow();
    }
    this.invalidate();
  }

  private loseContext(event: Event): void {
    event.preventDefault();
    this.contextLost = true;
    this.stopLoop();
  }

  /** three restores its own GPU state; the owner rebuilds what it baked, then a frame is drawn. */
  private restoreContext(): void {
    this.contextLost = false;
    this.options.onContextRestored();
    this.invalidate();
  }
}
