import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { AssetInstance } from './asset-cache';
import {
  cameraPosition,
  fitTransform,
  frameSeconds,
  orbitLimits,
  type FitBox,
  type StageSettings,
} from './scene-math';

// Camera, lights, environment and controls are the original card's (muttertag_threejs/index.html).
const FOV = 42;
const ENVIRONMENT_SIGMA = 0.04;
const MAX_PIXEL_RATIO = 2;

export interface StageOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; observed for size and visibility. */
  readonly container: HTMLElement;
  readonly settings: StageSettings;
  readonly interactive: boolean;
  readonly reducedMotion: boolean;
  /** three's shader diagnostics; they force synchronous shader compiles, so dev builds only. */
  readonly debug: boolean;
}

interface ShownAsset {
  readonly instance: AssetInstance;
  readonly box: FitBox;
  readonly mixer: AnimationMixer | null;
}

/**
 * One billet's WebGL scene and its single context. Model and settings change in place; the
 * renderer lives until `dispose`. Frames are drawn only while something moves (auto-rotation,
 * damping, an animation) and the canvas is on screen in a visible tab.
 */
export class SceneStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly lights: readonly DirectionalLight[];
  private readonly listeners = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly visibilityObserver: IntersectionObserver;
  private settings: StageSettings;
  private reducedMotion: boolean;
  private magnification = 1;
  private model: ShownAsset | null = null;
  private width = 0;
  private height = 0;
  private onScreen = false;
  private contextLost = false;
  private pointerHeld = false;
  private running = false;
  private needsRender = true;
  private lastFrame: number | null = null;
  private disposed = false;

  constructor(options: StageOptions) {
    this.canvas = options.canvas;
    this.container = options.container;
    this.settings = { ...options.settings };
    this.reducedMotion = options.reducedMotion;

    // Throws when WebGL is unavailable - before anything else exists that would need disposing.
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.debug.checkShaderErrors = options.debug;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.buildEnvironment();

    const key = new DirectionalLight(0xfff0e8, 0.4);
    key.position.set(1.5, 3, 2.5);
    const fill = new DirectionalLight(0xf0e8e0, 0.08);
    fill.position.set(-2, 1, 1);
    this.lights = [key, fill];
    this.scene.add(new AmbientLight(0xfff8f4, 0.15), key, fill);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = Math.PI * 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.enabled = options.interactive;
    // OrbitControls sets 'none' on connect; pan-y lets a phone scroll the page past the scene.
    this.canvas.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', this.invalidate);
    this.placeCamera(0);
    this.updateMotion();

    const signal = this.listeners.signal;
    const hold = (held: boolean) => () => this.holdPointer(held);
    this.canvas.addEventListener('pointerdown', hold(true), { signal });
    this.canvas.addEventListener('pointerup', hold(false), { signal });
    this.canvas.addEventListener('pointercancel', hold(false), { signal });
    this.canvas.addEventListener('webglcontextlost', (event) => this.loseContext(event), {
      signal,
    });
    this.canvas.addEventListener('webglcontextrestored', () => this.restoreContext(), { signal });
    document.addEventListener('visibilitychange', () => this.invalidate(), { signal });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.onScreen = entries[entries.length - 1].isIntersecting;
      this.invalidate();
    });
    this.visibilityObserver.observe(this.container);
    this.resize();
  }

  /**
   * Shows an asset instance and takes ownership of it: it is released when replaced, cleared or
   * disposed. Resolves once shaders are compiled and a first frame is drawn.
   */
  async show(instance: AssetInstance): Promise<void> {
    this.clear();
    if (this.disposed) {
      instance.release();
      return;
    }
    const box = measure(instance.root);
    const mixer = instance.clips.length > 0 ? new AnimationMixer(instance.root) : null;
    for (const clip of instance.clips) mixer?.clipAction(clip).play();
    mixer?.update(0);
    this.model = { instance, box, mixer };
    this.applyFit();
    this.scene.add(instance.root);

    await this.compile();
    if (this.model?.instance !== instance) return;
    this.invalidate();
    this.renderNow();
  }

  /** Removes and releases the shown model. */
  clear(): void {
    const model = this.model;
    if (!model) return;
    this.model = null;
    this.scene.remove(model.instance.root);
    model.mixer?.stopAllAction();
    model.mixer?.uncacheRoot(model.instance.root);
    model.instance.release();
    this.invalidate();
  }

  applySettings(next: StageSettings): void {
    const previous = this.settings;
    this.settings = { ...next };
    this.renderer.toneMappingExposure = next.exposure;
    if (next.fitSize !== previous.fitSize || next.yOffset !== previous.yOffset) this.applyFit();
    if (
      next.cameraDistance !== previous.cameraDistance ||
      next.cameraHeight !== previous.cameraHeight
    ) {
      this.placeCamera(this.azimuth());
    }
    this.updateMotion();
  }

  setInteractive(interactive: boolean): void {
    this.controls.enabled = interactive;
    if (!interactive) this.holdPointer(false);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.updateMotion();
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.listeners.abort();
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    this.controls.removeEventListener('change', this.invalidate);
    this.clear();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.lights.forEach((light) => light.dispose());
    this.renderer.dispose();
    // Frees the GPU context now instead of at garbage collection, so remounting a scene never
    // stacks contexts.
    this.renderer.forceContextLoss();
  }

  private readonly invalidate = (): void => {
    this.needsRender = true;
    this.syncLoop();
  };

  private readonly frame = (time: number): void => {
    const seconds = frameSeconds(this.lastFrame, time);
    this.lastFrame = time;
    const moved = this.controls.update(seconds);
    const mixer = this.animatedMixer();
    mixer?.update(seconds);
    if (moved || mixer || this.needsRender) this.render();
    else if (!this.hasMotion()) this.stopLoop();
  };

  private render(): void {
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  /** Draws synchronously, e.g. right after a resize cleared the drawing buffer. */
  private renderNow(): void {
    if (!this.contextLost && this.width > 0 && this.height > 0) this.render();
  }

  private syncLoop(): void {
    const canRun =
      !this.disposed &&
      !this.contextLost &&
      this.onScreen &&
      document.visibilityState === 'visible' &&
      this.width > 0 &&
      this.height > 0;
    if (!canRun) this.stopLoop();
    else if (this.needsRender || this.hasMotion()) this.startLoop();
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

  private hasMotion(): boolean {
    const rotating = this.controls.autoRotate && this.controls.autoRotateSpeed !== 0;
    return rotating || this.animatedMixer() !== null;
  }

  private animatedMixer(): AnimationMixer | null {
    return this.reducedMotion ? null : (this.model?.mixer ?? null);
  }

  private holdPointer(held: boolean): void {
    this.pointerHeld = held;
    this.updateMotion();
  }

  private updateMotion(): void {
    this.controls.autoRotate = this.settings.autoRotate && !this.reducedMotion && !this.pointerHeld;
    this.controls.autoRotateSpeed = this.settings.autoRotateSpeed;
    this.invalidate();
  }

  private applyFit(): void {
    if (!this.model) return;
    const { scale, position } = fitTransform(
      this.model.box,
      this.settings.fitSize,
      this.settings.yOffset,
    );
    this.model.instance.root.scale.setScalar(scale);
    this.model.instance.root.position.set(...position);
    this.invalidate();
  }

  private azimuth(): number {
    const offset = this.camera.position.clone().sub(this.controls.target);
    return Math.atan2(offset.x, offset.z);
  }

  /** Puts the camera at the document's distance and height, keeping the current azimuth. */
  private placeCamera(azimuth: number): void {
    const { cameraDistance, cameraHeight } = this.settings;
    const { minDistance, maxDistance } = orbitLimits(cameraDistance, cameraHeight);
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
    this.camera.position.set(...cameraPosition(azimuth, cameraDistance, cameraHeight));
    this.controls.target.set(0, 0, 0);
    this.controls.update(0);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const ratio = Math.min(devicePixelRatio * this.magnification, MAX_PIXEL_RATIO);
    if (width === this.width && height === this.height && ratio === this.renderer.getPixelRatio()) {
      return;
    }
    this.width = width;
    this.height = height;
    if (width > 0 && height > 0) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderNow();
    }
    this.invalidate();
  }

  private async compile(): Promise<void> {
    try {
      // compileAsync looks the extension up with get(), which warns where it is missing (Firefox).
      if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
        await this.renderer.compileAsync(this.scene, this.camera);
      } else {
        this.renderer.compile(this.scene, this.camera);
      }
    } catch {
      // The first render compiles instead.
    }
  }

  private loseContext(event: Event): void {
    event.preventDefault();
    this.contextLost = true;
    this.stopLoop();
  }

  /** three restores its own GPU state; what it cannot know is the PMREM environment we baked. */
  private restoreContext(): void {
    this.contextLost = false;
    this.buildEnvironment();
    this.invalidate();
  }

  private buildEnvironment(): void {
    // PMREM's shader trips an ANGLE (Windows) optimisation note that three reports as a warning
    // while diagnostics are on; it is not ours to fix, so they pause for it.
    const diagnostics = this.renderer.debug.checkShaderErrors;
    this.renderer.debug.checkShaderErrors = false;
    const generator = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const previous = this.scene.environment;
    try {
      this.scene.environment = generator.fromScene(room, ENVIRONMENT_SIGMA).texture;
    } finally {
      this.renderer.debug.checkShaderErrors = diagnostics;
      room.dispose();
      generator.dispose();
    }
    previous?.dispose();
  }
}

/** The instance's bounds before any fit is applied. */
function measure(root: AssetInstance['root']): FitBox {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const [x, y, z] = box.getCenter(new Vector3()).toArray();
  return { center: [x, y, z], maxDim: Math.max(size.x, size.y, size.z) };
}
