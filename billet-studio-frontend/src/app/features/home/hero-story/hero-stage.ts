import {
  type AnimationAction,
  AnimationMixer,
  DataTexture,
  type DirectionalLight,
  Euler,
  LoopOnce,
  type MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  type ShaderMaterial,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three';

import type { AssetCache, AssetInstance } from '../../../billet/scene/asset-cache';
import { addBilletLights, buildRoomEnvironment } from '../../../billet/scene/stage-environment';
import { StageRuntime } from '../../../billet/scene/stage-runtime';
import type { TemplateId } from '../../../billet/templates/templates';
import { HERO_ASSETS, type HeroLang, type HeroMode } from './hero-assets.generated';
import { fitVerticalFov, parseStoryMeta, sceneOffset, type StoryMeta } from './hero-framing';
import {
  applyRigFx,
  bindStoryRig,
  createGift,
  fxValue,
  releaseGift,
  type HeroGift,
  type StoryRig,
} from './hero-rig';
import {
  createScreenMaterial,
  setScreenBanner,
  setScreenTextures,
  setScreenValues,
} from './hero-screen-material';
import {
  advance,
  beatIndex,
  createClock,
  interact,
  OCCASIONS,
  replay,
  seekBeat,
  seekTime,
  settle,
  swapPose,
  type HeroClock,
  type HeroPhase,
  type SwapPose,
} from './hero-timeline';

/** One exposure for the whole hero; each gift's own is compensated on its materials. */
const HERO_EXPOSURE = 1;
const MAX_ANISOTROPY = 8;

// The idle phase: the phone floats, the gift turns like the billet's auto-rotation (0.45).
const FLOAT_METRES = 0.0025;
const FLOAT_TILT = 0.02;
const FLOAT_PERIOD = 5;
const IDLE_TURN = ((2 * Math.PI) / 60) * 0.45;

// Interaction: a drag across the whole stage turns the gift half a turn; a tap turns it 180°.
const TAP_SLOP_PX = 6;
const TAP_MS = 350;
const MOMENTUM_DECAY = 3.5;
const TURN_RATE = 6;
const MAX_PARALLAX_YAW = 0.045;
const MAX_PARALLAX_PITCH = 0.025;
const PARALLAX_RATE = 4;

/** Before `marks.land` the gift eases from GiftSlot's pose to its spot on the shown screen. */
const LAND_BLEND_SECONDS = 0.8;

const SETTLED: SwapPose = { showsPrevious: false, giftScale: 1, screenMix: 1 };

export interface HeroVariant {
  readonly lang: HeroLang;
  readonly mode: HeroMode;
}

/** What the page shows about the story; reported whenever one of it changes. */
export interface HeroStageState {
  readonly beat: number;
  readonly playing: boolean;
  readonly phase: HeroPhase;
  readonly occasion: TemplateId;
}

export interface HeroStageOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element whose size the canvas fills; observed for size and visibility. */
  readonly container: HTMLElement;
  readonly assets: AssetCache;
  readonly storyUrl: string;
  readonly variant: HeroVariant;
  /** A data-saver connection: no gift beyond the story's own is loaded. */
  readonly saveData: boolean;
  readonly debug: boolean;
  /** Poster capture: the drawn frame stays readable. */
  readonly preserveDrawingBuffer: boolean;
  readonly onState: (state: HeroStageState) => void;
  /** A drag or a tap turned the gift. */
  readonly onInteract: () => void;
  /** The story's screens failed to load after the first frame: the clock could never pass its gate. */
  readonly onError: (error: unknown) => void;
}

interface LoadedStory {
  readonly instance: AssetInstance;
  readonly meta: StoryMeta;
  readonly rig: StoryRig;
  readonly mixer: AnimationMixer;
  readonly action: AnimationAction;
}

/** The screens of one language and colour mode; replaced as a whole once a new one has loaded. */
interface ScreenSet {
  readonly variant: HeroVariant;
  readonly lock: Texture;
  readonly notification: Texture;
  /** Billet screens by occasion; only the ones bound to the display are on the GPU. */
  readonly billets: Map<TemplateId, Texture>;
}

interface PrintSet {
  readonly lang: HeroLang;
  readonly front: Texture;
  readonly inside: Texture;
}

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startTime: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  moved: boolean;
}

/**
 * The home page's 3D story (docs/hero-story.md) on a StageRuntime: the story GLB scrubbed to a
 * pure clock (hero-timeline.ts), the display drawn by its own shader, the gifts from the shared
 * AssetCache. Frames are drawn only while the clock plays or the gift moves, and never off-screen.
 */
export class HeroStage {
  private readonly options: HeroStageOptions;
  private readonly runtime: StageRuntime;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.01, 50);
  private readonly lights: readonly DirectionalLight[];
  private readonly loads = new AbortController();
  private readonly textureLoader = new TextureLoader();
  private readonly anisotropy: number;
  private readonly placeholder: DataTexture;
  private readonly screen: ShaderMaterial;
  private readonly giftSpin = new Object3D();

  private story: LoadedStory | null = null;
  private clock: HeroClock | null = null;
  private variant: HeroVariant;
  private variantToken = 0;
  private screens: ScreenSet | null = null;
  private print: PrintSet | null = null;
  private boundScreens: readonly Texture[] = [];
  private readonly pendingScreens = new Set<TemplateId>();
  /** Settles once the first screen set is on the display (or can never be). */
  private readonly firstScreens: Promise<void>;
  private settleFirstScreens: (error?: unknown) => void = () => undefined;
  private readonly gifts = new Map<TemplateId, HeroGift>();
  private readonly giftLoads = new Map<TemplateId, Promise<void>>();
  private readonly failed = new Set<TemplateId>();
  private preloading = false;
  private shownGift: HeroGift | null = null;
  private lastState: HeroStageState | null = null;

  private idleSeconds = 0;
  private spin = 0;
  private spinVelocity = 0;
  private pendingTurn = 0;
  private drag: Drag | null = null;
  private parallaxEnabled = false;
  private readonly parallaxTarget = { x: 0, y: 0 };
  private readonly parallax = { x: 0, y: 0 };

  private readonly camPosition = new Vector3();
  private readonly camTarget = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpEuler = new Euler();
  private readonly tmpQuaternion = new Quaternion();

  constructor(options: HeroStageOptions) {
    this.options = options;
    this.variant = options.variant;
    // Throws when WebGL is unavailable - before anything else exists that would need disposing.
    this.runtime = new StageRuntime({
      canvas: options.canvas,
      container: options.container,
      debug: options.debug,
      exposure: HERO_EXPOSURE,
      // ACES washes the printed card's pale pink out to white; Neutral keeps print colours.
      toneMapping: NeutralToneMapping,
      preserveDrawingBuffer: options.preserveDrawingBuffer,
      update: (seconds) => this.update(seconds),
      draw: () => this.runtime.renderer.render(this.scene, this.camera),
      hasMotion: () => this.hasMotion(),
      onResize: (width, height) => this.resize(width / height),
      onContextRestored: () => this.bakeEnvironment(),
      releaseScene: () => this.release(),
    });
    this.bakeEnvironment();
    this.anisotropy = Math.min(
      MAX_ANISOTROPY,
      this.runtime.renderer.capabilities.getMaxAnisotropy(),
    );

    // The billet scene's lights, so a gift looks as it does in a billet.
    this.lights = addBilletLights(this.scene);

    this.placeholder = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.screen = createScreenMaterial(this.placeholder);
    this.giftSpin.name = 'giftSpin';
    // Vertical swipes scroll the page, horizontal drags turn the gift.
    options.canvas.style.touchAction = 'pan-y';
    this.listen();
    this.firstScreens = new Promise<void>((resolve, reject) => {
      this.settleFirstScreens = (error) => (error === undefined ? resolve() : reject(error));
    });
    // Rejections are handled by whoever awaits screensReady(); onError reports them too.
    this.firstScreens.catch(() => undefined);
  }

  /**
   * Loads the story, its print and its gift, draws the first frame at t = 0 (paused) and resolves
   * with the story's timing. The screen textures load on in parallel; the clock waits for them at
   * `gates.screens`, and a jump past that gate (a seek, settle) waits for them with
   * {@link screensReady} before it is shown. Rejects on a broken story (the page's fallback).
   */
  async load(): Promise<StoryMeta> {
    const signal = this.loads.signal;
    const instance = await this.options.assets.instantiate(this.options.storyUrl, { signal });
    let story: LoadedStory;
    try {
      story = this.bindStory(instance);
    } catch (error) {
      instance.release();
      throw error;
    }
    this.story = story;
    this.clock = createClock(story.meta);
    this.scene.add(instance.root);

    this.loadScreens(this.variant);
    await Promise.all([
      this.switchPrint(this.variant.lang),
      this.ensureGift(story.meta.gift.templateId),
    ]);
    signal.throwIfAborted();
    this.pose();
    await this.runtime.compile(this.scene, this.camera);
    signal.throwIfAborted();
    this.runtime.start();
    this.report();
    return story.meta;
  }

  /** Resolves once the lock, message and billet screens are on the display; rejects if they fail. */
  screensReady(): Promise<void> {
    return this.firstScreens;
  }

  /** The clock stands at or past `gates.screens`, where the display needs its screens. */
  needsScreens(): boolean {
    const story = this.story;
    const clock = this.clock;
    return !!story && !!clock && clock.time >= story.meta.gates.screens;
  }

  play(): void {
    this.command((clock) => ({ ...clock, playing: true }));
  }

  pause(): void {
    this.command((clock) => ({ ...clock, playing: false }));
  }

  replay(): void {
    this.resetMotion();
    this.command((clock, meta) => replay(clock, meta));
  }

  seekBeat(index: number): void {
    this.resetMotion();
    this.command((clock, meta) => seekBeat(clock, meta, index));
  }

  /** Dev page (`?t=`): a story time, paused. */
  seekTime(time: number): void {
    this.resetMotion();
    this.command((clock, meta) => ({ ...seekTime(clock, meta, time), playing: false }));
  }

  /** The end of the story: paused for reduced motion, playing on for a later visit. */
  settle(playing: boolean): void {
    this.resetMotion();
    this.command((clock, meta) => ({ ...settle(clock, meta), playing }));
  }

  setParallax(enabled: boolean): void {
    this.parallaxEnabled = enabled;
    if (!enabled) {
      this.parallaxTarget.x = 0;
      this.parallaxTarget.y = 0;
      this.runtime.invalidate();
    }
  }

  /** The site's language or colour mode changed: the new textures replace the old once loaded. */
  setVariant(variant: HeroVariant): void {
    if (sameVariant(variant, this.variant)) return;
    this.variant = variant;
    if (!this.story) return;
    this.loadScreens(variant);
    void this.switchPrint(variant.lang).catch(() => undefined);
  }

  /** GPU resources held, for the dev page's check that occasion cycles leak nothing. */
  memory(): { geometries: number; textures: number; programs: number } {
    const { info } = this.runtime.renderer;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.runtime.dispose();
  }

  /** A lost context loses the baked environment; three restores everything else itself. */
  private bakeEnvironment(): void {
    buildRoomEnvironment(this.runtime.renderer, this.scene);
  }

  private bindStory(instance: AssetInstance): LoadedStory {
    const meta = parseStoryMeta(instance.root.userData['heroStory']);
    const clip = instance.clips.find((candidate) => candidate.name === meta.clip);
    if (!clip) throw new Error(`Hero story: clip ${meta.clip} is missing`);
    const rig = bindStoryRig(instance.root, this.screen);
    const mixer = new AnimationMixer(instance.root);
    // Never played freely: every frame sets action.time and applies it with update(0).
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    this.resize(this.camera.aspect, meta);
    return { instance, meta, rig, mixer, action };
  }

  private command(change: (clock: HeroClock, meta: StoryMeta) => HeroClock): void {
    const story = this.story;
    const clock = this.clock;
    if (!story || !clock || this.runtime.disposed) return;
    const next = change(clock, story.meta);
    if (next.phase === 'story' || clock.phase === 'story') this.idleSeconds = 0;
    this.clock = next;
    this.pose();
    this.runtime.invalidate();
    this.report();
  }

  private resetMotion(): void {
    this.spin = 0;
    this.spinVelocity = 0;
    this.pendingTurn = 0;
    this.drag = null;
  }

  private update(seconds: number): boolean {
    const story = this.story;
    const before = this.clock;
    if (!story || !before) return false;
    const clock = advance(before, seconds, story.meta, {
      gatesOpen: this.gatesOpen(),
      readyOccasions: this.readyOccasions(),
    });
    this.clock = clock;
    // Every step runs (each advances its own state); any that moved redraws.
    const moved = [
      clockMoved(before, clock),
      this.animate(clock, seconds),
      this.updateSpin(seconds),
      this.updateParallax(seconds),
    ].includes(true);
    if (clock.phase === 'idle') this.preloadNext(clock);
    if (moved) this.pose();
    this.report();
    return moved;
  }

  /** What moves on its own while the clock plays: the idle float and turn, the gift's clip. */
  private animate(clock: HeroClock, seconds: number): boolean {
    if (!clock.playing) return false;
    let moved = false;
    if (clock.phase === 'idle') {
      this.idleSeconds += seconds;
      if (!this.drag) this.spin += IDLE_TURN * seconds;
      moved = true;
    }
    // During the story the gift's clip runs on the story clock (pose), as authored in Blender.
    const mixer = this.shownGift?.mixer;
    if (mixer && clock.phase === 'idle') {
      mixer.update(seconds);
      moved = true;
    }
    return moved;
  }

  private hasMotion(): boolean {
    return (
      this.clock?.playing === true ||
      this.spinVelocity !== 0 ||
      this.pendingTurn !== 0 ||
      this.parallax.x !== this.parallaxTarget.x ||
      this.parallax.y !== this.parallaxTarget.y
    );
  }

  /** Applies the clock to the scene: story pose, idle float, Fx, camera, gift and display. */
  private pose(): void {
    const story = this.story;
    const clock = this.clock;
    if (!story || !clock) return;
    const { rig, meta } = story;
    // The mixer writes a property only when its value changed since it last wrote it: the idle
    // float is taken off first, so the phone is where the mixer left it either way.
    rig.phone.position.copy(rig.phonePose.position);
    rig.phone.quaternion.copy(rig.phonePose.quaternion);
    story.action.time = clock.time;
    story.mixer.update(0);
    // The heart's beat is authored against the story time (it faces the viewer at the pop and the
    // landing), so seeks and a held gate keep it in step.
    if (clock.phase === 'story') this.shownGift?.mixer?.setTime(clock.time);
    rig.phonePose.position.copy(rig.phone.position);
    rig.phonePose.quaternion.copy(rig.phone.quaternion);
    if (clock.phase === 'idle') this.floatPhone(rig);
    applyRigFx(rig);
    story.instance.root.updateMatrixWorld(true);
    this.placeCamera(rig, meta);
    const swap = clock.phase === 'idle' ? swapPose(clock.sinceSwap) : SETTLED;
    this.placeGift(rig, meta, clock, swap);
    this.updateScreen(rig, clock, swap);
  }

  private floatPhone(rig: StoryRig): void {
    const phase = (this.idleSeconds / FLOAT_PERIOD) * 2 * Math.PI;
    rig.phone.position.y += FLOAT_METRES * Math.sin(phase);
    this.tmpEuler.set(FLOAT_TILT * Math.sin(phase * 0.7), FLOAT_TILT * Math.sin(phase * 0.5), 0);
    rig.phone.quaternion.multiply(this.tmpQuaternion.setFromEuler(this.tmpEuler));
  }

  private placeCamera(rig: StoryRig, meta: StoryMeta): void {
    rig.cam.getWorldPosition(this.camPosition);
    rig.camTarget.getWorldPosition(this.camTarget);
    const offset = this.tmp.subVectors(this.camPosition, this.camTarget);
    if (this.parallax.x !== 0 || this.parallax.y !== 0) {
      offset.applyAxisAngle(this.camera.up.set(0, 1, 0), -this.parallax.x * MAX_PARALLAX_YAW);
      const right = this.tmpOrigin.crossVectors(this.camera.up, offset).normalize();
      offset.applyAxisAngle(right, this.parallax.y * MAX_PARALLAX_PITCH);
    }
    this.camera.position.copy(this.camTarget).add(offset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camTarget);
    this.resize(this.camera.aspect, meta);
  }

  private resize(aspect: number, meta = this.story?.meta): void {
    const fov = meta ? fitVerticalFov(meta.fovDeg, meta.aspect, aspect) : this.camera.fov;
    if (fov === this.camera.fov && aspect === this.camera.aspect) return;
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * GiftSlot → giftSpin during the story, Phone_ScreenDock → giftSpin once it ended, so the gift
   * follows the floating phone. On the screen, the gift sits in the shown billet's 3D area.
   */
  private placeGift(rig: StoryRig, meta: StoryMeta, clock: HeroClock, swap: SwapPose): void {
    const id = swap.showsPrevious ? clock.previous : clock.occasion;
    this.showGift(this.gifts.get(id) ?? null);
    const lang = this.screens?.variant.lang ?? this.variant.lang;
    const { dockExtras } = rig;
    const offset = sceneOffset(
      HERO_ASSETS.screens[id][lang].light.sceneRect,
      dockExtras.sceneRectDe,
      dockExtras.screenWidthM,
      dockExtras.screenHeightM,
    );
    const dockScale = rig.dock.scale.x || 1;
    const local = this.tmp.set(offset.x / dockScale, offset.y / dockScale, 0);
    let scale = offset.scale;
    if (clock.phase === 'idle') {
      if (this.giftSpin.parent !== rig.dock) rig.dock.add(this.giftSpin);
      this.giftSpin.position.copy(local);
    } else {
      if (this.giftSpin.parent !== rig.slot) rig.slot.add(this.giftSpin);
      const land = meta.marks.land;
      const weight = smoothstep((clock.time - (land - LAND_BLEND_SECONDS)) / LAND_BLEND_SECONDS);
      scale = 1 + (offset.scale - 1) * weight;
      if (weight > 0) {
        // The dock-local offset as a world vector, added to GiftSlot's world position.
        const shift = rig.dock.localToWorld(local).sub(rig.dock.getWorldPosition(this.tmpOrigin));
        const target = rig.slot.getWorldPosition(this.tmpOrigin).addScaledVector(shift, weight);
        this.giftSpin.position.copy(rig.slot.worldToLocal(target));
      } else {
        this.giftSpin.position.set(0, 0, 0);
      }
    }
    const size = scale * swap.giftScale;
    this.giftSpin.visible = size > 1e-3;
    this.giftSpin.scale.setScalar(Math.max(size, 1e-3));
    this.giftSpin.rotation.set(0, this.spin, 0);
  }

  private showGift(gift: HeroGift | null): void {
    if (gift === this.shownGift) return;
    this.shownGift?.fit.removeFromParent();
    this.shownGift = gift;
    if (gift) this.giftSpin.add(gift.fit);
  }

  private updateScreen(rig: StoryRig, clock: HeroClock, swap: SwapPose): void {
    const set = this.screens;
    const to = set?.billets.get(clock.occasion) ?? this.placeholder;
    const from = set?.billets.get(clock.previous) ?? to;
    setScreenTextures(this.screen, {
      lock: set?.lock ?? this.placeholder,
      notification: set?.notification ?? this.placeholder,
      billetA: from,
      billetB: to,
    });
    setScreenValues(this.screen, {
      wake: fxValue(rig, 'Wake'),
      notif: fxValue(rig, 'Notif'),
      billet: fxValue(rig, 'Billet'),
      billetMix: swap.screenMix,
    });
    // At most the two billet screens of a crossfade stay on the GPU; the others re-upload on use.
    const bound = [from, to].filter((texture) => texture !== this.placeholder);
    for (const texture of this.boundScreens) {
      if (!bound.includes(texture)) texture.dispose();
    }
    this.boundScreens = bound;
  }

  private gatesOpen(): boolean {
    const story = this.story;
    return !!story && !!this.screens?.billets.has(story.meta.gift.templateId);
  }

  private readyOccasions(): ReadonlySet<TemplateId> {
    const billets = this.screens?.billets;
    return new Set(OCCASIONS.filter((id) => this.gifts.has(id) && billets?.has(id)));
  }

  /** In the idle phase, the next occasion's gift and screen, one at a time; never on saveData. */
  private preloadNext(clock: HeroClock): void {
    if (this.preloading || this.options.saveData) return;
    const start = OCCASIONS.indexOf(clock.occasion);
    const ready = this.readyOccasions();
    const next = [...OCCASIONS.slice(start + 1), ...OCCASIONS.slice(0, start)].find(
      (id) => !ready.has(id) && !this.failed.has(id),
    );
    if (!next) return;
    this.preloading = true;
    Promise.all([this.ensureGift(next), this.ensureScreen(next)])
      .catch(() => this.failed.add(next))
      .finally(() => (this.preloading = false));
  }

  private ensureGift(id: TemplateId): Promise<void> {
    if (this.gifts.has(id)) return Promise.resolve();
    let pending = this.giftLoads.get(id);
    if (!pending) {
      const asset = HERO_ASSETS.gifts[id];
      pending = this.options.assets
        .instantiate(asset.url, { signal: this.loads.signal })
        .then((instance) => {
          if (this.runtime.disposed) {
            instance.release();
            return;
          }
          this.gifts.set(id, createGift(instance, asset, HERO_EXPOSURE));
        })
        .finally(() => this.giftLoads.delete(id));
      this.giftLoads.set(id, pending);
    }
    return pending;
  }

  /** Adds an occasion's billet screen to the current set (not bound, so not uploaded yet). */
  private async ensureScreen(id: TemplateId): Promise<void> {
    const set = this.screens;
    if (!set || set.billets.has(id) || this.pendingScreens.has(id)) return;
    this.pendingScreens.add(id);
    try {
      const { lang, mode } = set.variant;
      const texture = await this.loadTexture(HERO_ASSETS.screens[id][lang][mode].url);
      if (this.screens === set) set.billets.set(id, texture);
      else texture.dispose();
    } finally {
      this.pendingScreens.delete(id);
    }
  }

  /**
   * A failed switch keeps the current screens; without any, the clock could never pass its gate,
   * so the story gives up (onError).
   */
  private loadScreens(variant: HeroVariant): void {
    this.switchScreens(variant).catch((error: unknown) => {
      if (this.screens || this.runtime.disposed) return;
      this.settleFirstScreens(error);
      this.options.onError(error);
    });
  }

  /**
   * Loads the lock screen, the message and the billet screens in use for `variant`, then replaces
   * the current set (the old one stays on screen meanwhile) and frees it.
   */
  private async switchScreens(variant: HeroVariant): Promise<void> {
    const token = ++this.variantToken;
    const clock = this.clock;
    const story = this.story;
    if (!clock || !story) return;
    const { lang, mode } = variant;
    const occasions = [...new Set([story.meta.gift.templateId, clock.occasion, clock.previous])];
    const [lock, notification, ...billets] = await settleAll([
      this.loadTexture(HERO_ASSETS.lock[lang][mode].url),
      this.loadTexture(HERO_ASSETS.notification[lang][mode].url),
      ...occasions.map((id) => this.loadTexture(HERO_ASSETS.screens[id][lang][mode].url)),
    ]);
    if (token !== this.variantToken || this.runtime.disposed) {
      [lock, notification, ...billets].forEach((texture) => texture.dispose());
      return;
    }
    const previous = this.screens;
    this.screens = {
      variant,
      lock,
      notification,
      billets: new Map(occasions.map((id, index) => [id, billets[index]])),
    };
    const banner = HERO_ASSETS.notification[lang][mode];
    setScreenBanner(this.screen, banner.cssWidth, banner.cssHeight);
    this.pose();
    this.runtime.invalidate();
    if (previous) disposeScreens(previous);
    this.settleFirstScreens();
  }

  private async switchPrint(lang: HeroLang): Promise<void> {
    if (this.print?.lang === lang) return;
    const [front, inside] = await settleAll([
      this.loadTexture(HERO_ASSETS.printFront[lang].url),
      this.loadTexture(HERO_ASSETS.printInside[lang].url),
    ]);
    const rig = this.story?.rig;
    if (!rig || this.runtime.disposed || this.variant.lang !== lang) {
      front.dispose();
      inside.dispose();
      return;
    }
    const previous = this.print;
    this.print = { lang, front, inside };
    setMap(rig.printFront, front);
    setMap(rig.printInside, inside);
    this.runtime.invalidate();
    previous?.front.dispose();
    previous?.inside.dispose();
  }

  private async loadTexture(url: string): Promise<Texture> {
    const texture = await this.textureLoader.loadAsync(url);
    if (this.runtime.disposed) {
      texture.dispose();
      throw new Error('Hero stage disposed');
    }
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private report(): void {
    const clock = this.clock;
    const story = this.story;
    if (!clock || !story) return;
    const state: HeroStageState = {
      beat: beatIndex(clock.time, story.meta),
      playing: clock.playing,
      phase: clock.phase,
      occasion: clock.occasion,
    };
    const last = this.lastState;
    if (
      last &&
      last.beat === state.beat &&
      last.playing === state.playing &&
      last.phase === state.phase &&
      last.occasion === state.occasion
    ) {
      return;
    }
    this.lastState = state;
    this.options.onState(state);
  }

  // ---- Interaction -------------------------------------------------------------------------

  private listen(): void {
    const { canvas, container } = this.options;
    const signal = this.runtime.signal;
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event), { signal });
    // A vertical swipe became a page scroll.
    canvas.addEventListener('pointercancel', () => (this.drag = null), { signal });
    container.addEventListener('pointermove', (event) => this.aim(event), { signal });
    container.addEventListener('pointerleave', () => this.aimAt(0, 0), { signal });
  }

  private pointerDown(event: PointerEvent): void {
    if (!event.isPrimary || this.clock?.phase !== 'idle') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startTime: event.timeStamp,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
    };
    this.spinVelocity = 0;
    this.pendingTurn = 0;
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) > TAP_SLOP_PX) {
      drag.moved = true;
      this.options.canvas.setPointerCapture?.(event.pointerId);
    }
    if (!drag.moved) return;
    const width = this.options.container.clientWidth || 1;
    const angle = ((event.clientX - drag.lastX) / width) * Math.PI;
    const seconds = (event.timeStamp - drag.lastTime) / 1000;
    if (seconds > 0) drag.velocity = drag.velocity * 0.5 + (angle / seconds) * 0.5;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    this.spin += angle;
    this.hold();
  }

  private pointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (!drag.moved) {
      // A tap turns the gift halfway (WCAG 2.5.7: dragging has a single-pointer alternative).
      if (event.timeStamp - drag.startTime <= TAP_MS) {
        this.pendingTurn += Math.PI;
        this.hold();
      }
      return;
    }
    // A drag that stopped before release keeps no momentum.
    this.spinVelocity = event.timeStamp - drag.lastTime < 80 ? drag.velocity : 0;
    this.runtime.invalidate();
  }

  private hold(): void {
    const clock = this.clock;
    if (clock) this.clock = interact(clock);
    this.options.onInteract();
    this.pose();
    this.runtime.invalidate();
  }

  private updateSpin(seconds: number): boolean {
    let moved = false;
    if (this.spinVelocity !== 0) {
      this.spin += this.spinVelocity * seconds;
      this.spinVelocity *= Math.exp(-MOMENTUM_DECAY * seconds);
      if (Math.abs(this.spinVelocity) < 0.01) this.spinVelocity = 0;
      moved = true;
    }
    if (this.pendingTurn !== 0) {
      const step = this.pendingTurn * (1 - Math.exp(-TURN_RATE * seconds));
      this.spin += step;
      this.pendingTurn -= step;
      if (Math.abs(this.pendingTurn) < 1e-3) {
        this.spin += this.pendingTurn;
        this.pendingTurn = 0;
      }
      moved = true;
    }
    return moved;
  }

  /** Mouse parallax: the camera leans a little towards the pointer. */
  private aim(event: PointerEvent): void {
    if (!this.parallaxEnabled || event.pointerType !== 'mouse') return;
    const rect = this.options.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.aimAt(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ((event.clientY - rect.top) / rect.height) * 2 - 1,
    );
  }

  private aimAt(x: number, y: number): void {
    this.parallaxTarget.x = Math.min(1, Math.max(-1, x));
    this.parallaxTarget.y = Math.min(1, Math.max(-1, y));
    this.runtime.invalidate();
  }

  private updateParallax(seconds: number): boolean {
    const { parallax, parallaxTarget: target } = this;
    if (parallax.x === target.x && parallax.y === target.y) return false;
    const blend = 1 - Math.exp(-PARALLAX_RATE * seconds);
    parallax.x += (target.x - parallax.x) * blend;
    parallax.y += (target.y - parallax.y) * blend;
    if (Math.abs(target.x - parallax.x) < 1e-3 && Math.abs(target.y - parallax.y) < 1e-3) {
      parallax.x = target.x;
      parallax.y = target.y;
    }
    return true;
  }

  /** Runs inside `runtime.dispose`, after the loop stopped and before the renderer is disposed. */
  private release(): void {
    this.loads.abort();
    this.settleFirstScreens(new Error('Hero stage disposed'));
    this.variantToken++;
    const story = this.story;
    this.story = null;
    if (story) {
      this.scene.remove(story.instance.root);
      story.mixer.stopAllAction();
      story.mixer.uncacheRoot(story.instance.root);
      story.rig.owned.forEach((material) => material.dispose());
      story.instance.release();
    }
    this.gifts.forEach((gift) => releaseGift(gift));
    this.gifts.clear();
    this.shownGift = null;
    if (this.screens) disposeScreens(this.screens);
    this.screens = null;
    this.print?.front.dispose();
    this.print?.inside.dispose();
    this.print = null;
    this.screen.dispose();
    this.placeholder.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.lights.forEach((light) => light.dispose());
  }
}

/** A material that had no map compiles a new program for one. */
function setMap(materials: readonly MeshStandardMaterial[], map: Texture): void {
  for (const material of materials) {
    if (!material.map) material.needsUpdate = true;
    material.map = map;
  }
}

function clockMoved(before: HeroClock, after: HeroClock): boolean {
  return (
    after.time !== before.time ||
    after.phase !== before.phase ||
    after.occasion !== before.occasion ||
    after.sinceSwap !== before.sinceSwap
  );
}

function sameVariant(a: HeroVariant, b: HeroVariant): boolean {
  return a.lang === b.lang && a.mode === b.mode;
}

function disposeScreens(set: ScreenSet): void {
  set.lock.dispose();
  set.notification.dispose();
  set.billets.forEach((texture) => texture.dispose());
}

/** Like Promise.all, but frees the textures that did load when another one failed. */
async function settleAll(loads: readonly Promise<Texture>[]): Promise<Texture[]> {
  const results = await Promise.allSettled(loads);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    throw failure.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<Texture>).value);
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
