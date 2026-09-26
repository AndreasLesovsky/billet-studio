import {
  AmbientLight,
  AnimationMixer,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AssetInstance } from './asset-cache';
import {
  cameraPosition,
  fitTransform,
  orbitLimits,
  type FitBox,
  type StageSettings,
  type WheelZoom,
} from './scene-math';
import { buildRoomEnvironment } from './stage-environment';
import { StageRuntime } from './stage-runtime';

// Camera, lights and controls are the original card's (muttertag_threejs/index.html).
const FOV = 42;

export interface StageOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; observed for size and visibility. */
  readonly container: HTMLElement;
  readonly settings: StageSettings;
  readonly interactive: boolean;
  readonly reducedMotion: boolean;
  readonly wheelZoom: WheelZoom;
  /** A wheel over the interactive scene that scrolls the page because it lacks Ctrl/⌘. */
  readonly onPlainWheel: () => void;
  /** three's shader diagnostics; they force synchronous shader compiles, so dev builds only. */
  readonly debug: boolean;
}

interface ShownAsset {
  readonly instance: AssetInstance;
  readonly box: FitBox;
  readonly mixer: AnimationMixer | null;
}

/**
 * One billet's 3D scene: camera, lights, orbit controls and the shown model, drawn by a
 * StageRuntime that owns the renderer, its single context and the render-on-demand loop. Model
 * and settings change in place; the renderer lives until `dispose`. Frames are drawn only while
 * something moves (auto-rotation, damping, an animation) and the canvas is on screen in a visible
 * tab.
 */
export class SceneStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly runtime: StageRuntime;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly lights: readonly DirectionalLight[];
  private settings: StageSettings;
  private reducedMotion: boolean;
  private wheelZoom: WheelZoom;
  private readonly onPlainWheel: () => void;
  private model: ShownAsset | null = null;
  private pointerHeld = false;

  constructor(options: StageOptions) {
    this.canvas = options.canvas;
    this.container = options.container;
    this.settings = { ...options.settings };
    this.reducedMotion = options.reducedMotion;
    this.wheelZoom = options.wheelZoom;
    this.onPlainWheel = options.onPlainWheel;

    // Throws when WebGL is unavailable - before anything else exists that would need disposing.
    this.runtime = new StageRuntime({
      canvas: this.canvas,
      container: this.container,
      debug: options.debug,
      exposure: this.settings.exposure,
      update: (seconds) => this.update(seconds),
      draw: () => this.runtime.renderer.render(this.scene, this.camera),
      hasMotion: () => this.hasMotion(),
      onResize: (width, height) => {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      },
      onContextRestored: () => buildRoomEnvironment(this.runtime.renderer, this.scene),
      releaseScene: () => this.release(),
    });
    buildRoomEnvironment(this.runtime.renderer, this.scene);

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
    this.controls.addEventListener('change', this.runtime.invalidate);
    this.placeCamera(0);
    this.updateMotion();
    this.listen();
    this.runtime.start();
  }

  /**
   * Shows an asset instance and takes ownership of it: it is released when replaced, cleared or
   * disposed. Resolves once shaders are compiled and a first frame is drawn.
   */
  async show(instance: AssetInstance): Promise<void> {
    this.clear();
    if (this.runtime.disposed) {
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

    await this.runtime.compile(this.scene, this.camera);
    if (this.model?.instance !== instance) return;
    this.runtime.invalidate();
    this.runtime.renderNow();
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
    this.runtime.invalidate();
  }

  applySettings(next: StageSettings): void {
    const previous = this.settings;
    this.settings = { ...next };
    this.runtime.setExposure(next.exposure);
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

  setWheelZoom(wheelZoom: WheelZoom): void {
    this.wheelZoom = wheelZoom;
  }

  /** How much a CSS transform (the editor's preview zoom) magnifies the canvas. */
  setMagnification(magnification: number): void {
    this.runtime.setMagnification(magnification);
  }

  dispose(): void {
    this.runtime.dispose();
  }

  /** Runs inside `runtime.dispose`, after the loop stopped and before the renderer is disposed. */
  private release(): void {
    this.controls.removeEventListener('change', this.runtime.invalidate);
    this.clear();
    this.controls.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.lights.forEach((light) => light.dispose());
  }

  /** One frame of controls and animation; true when either moved the picture. */
  private update(seconds: number): boolean {
    const moved = this.controls.update(seconds);
    const mixer = this.animatedMixer();
    mixer?.update(seconds);
    return moved || mixer !== null;
  }

  private hasMotion(): boolean {
    const rotating = this.controls.autoRotate && this.controls.autoRotateSpeed !== 0;
    return rotating || this.animatedMixer() !== null;
  }

  private animatedMixer(): AnimationMixer | null {
    return this.reducedMotion ? null : (this.model?.mixer ?? null);
  }

  private listen(): void {
    const signal = this.runtime.signal;
    const hold = (held: boolean) => () => this.holdPointer(held);
    this.canvas.addEventListener('pointerdown', hold(true), { signal });
    this.canvas.addEventListener('pointerup', hold(false), { signal });
    this.canvas.addEventListener('pointercancel', hold(false), { signal });
    // Capture on the container runs before OrbitControls' wheel listener on the canvas, which with
    // zoom off neither zooms nor prevents the event: the page scrolls. Only the wheel is gated -
    // every pointer gesture (a touch pinch, a middle-button drag) starts with zoom on again.
    this.container.addEventListener('wheel', (event) => this.gateWheel(event), {
      capture: true,
      passive: true,
      signal,
    });
    this.container.addEventListener('pointerdown', () => (this.controls.enableZoom = true), {
      capture: true,
      signal,
    });
  }

  private gateWheel(event: WheelEvent): void {
    const modified = event.ctrlKey || event.metaKey;
    this.controls.enableZoom = this.wheelZoom === 'modifier' && modified;
    if (this.wheelZoom === 'modifier' && !modified && this.controls.enabled) this.onPlainWheel();
  }

  private holdPointer(held: boolean): void {
    this.pointerHeld = held;
    this.updateMotion();
  }

  private updateMotion(): void {
    this.controls.autoRotate = this.settings.autoRotate && !this.reducedMotion && !this.pointerHeld;
    this.controls.autoRotateSpeed = this.settings.autoRotateSpeed;
    this.runtime.invalidate();
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
    this.runtime.invalidate();
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
}

/** The instance's bounds before any fit is applied. */
function measure(root: AssetInstance['root']): FitBox {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const [x, y, z] = box.getCenter(new Vector3()).toArray();
  return { center: [x, y, z], maxDim: Math.max(size.x, size.y, size.z) };
}
