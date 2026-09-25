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
  signal,
  untracked,
} from '@angular/core';

import type { BilletDocument, ParticleShape } from '../billet-document';
import { mediaQuery, PREFERS_REDUCED_MOTION } from '../view/media-query';
import { ParticleSim, type Particle, type ParticleSettings } from './particle-sim';

/** The parametric heart (16 sin³t, 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t) as a clip-path. */
function heartClipPath(points: number): string {
  const curve = Array.from({ length: points }, (_, i) => {
    const t = (i / points) * 2 * Math.PI;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [16 * Math.sin(t) ** 3, -y] as const;
  });
  const xs = curve.map(([x]) => x);
  const ys = curve.map(([, y]) => y);
  const [left, right, top, bottom] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const percent = (value: number, min: number, max: number) =>
    `${(((value - min) / (max - min)) * 100).toFixed(1)}%`;
  const corners = curve.map(([x, y]) => `${percent(x, left, right)} ${percent(y, top, bottom)}`);
  return `polygon(${corners.join(', ')})`;
}

/** petal..confetti: the card template's shapes. */
const SHAPE_STYLE: Readonly<Record<ParticleShape, Partial<CSSStyleDeclaration>>> = {
  petal: { borderRadius: '60% 40% 60% 40% / 50% 50% 50% 50%' },
  snowflake: { borderRadius: '50%' },
  leaf: { borderRadius: '0% 80% 0% 80% / 50% 80% 20% 50%' },
  confetti: { borderRadius: '0.125rem' },
  heart: { clipPath: heartClipPath(32) },
};

const settingsKey = (s: ParticleSettings | null) =>
  s ? [s.shape, s.density, s.speed, s.size, ...s.colors].join() : '';

const sameSettings = (a: ParticleSettings | null, b: ParticleSettings | null) =>
  settingsKey(a) === settingsKey(b);

/**
 * The falling particles over the whole billet: an absolutely positioned layer (never fixed) of
 * plain elements, driven by requestAnimationFrame. The loop runs only while something falls, the
 * billet is on screen and the tab is visible; settled particles are drawn once. Nothing at all
 * under prefers-reduced-motion. BilletView renders it only while particles are switched on.
 */
@Component({
  selector: 'app-billet-particles',
  template: '',
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 1;
      overflow: hidden;
      pointer-events: none;
      contain: strict;
    }
  `,
})
export class BilletParticles {
  readonly config = input.required<BilletDocument['particles']>();

  private readonly document = inject(DOCUMENT);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly reducedMotion = mediaQuery(PREFERS_REDUCED_MOTION);
  private readonly rendered = signal(false);

  /** Null while off; value-compared, so an edit elsewhere in the document never restarts them. */
  private readonly settings = computed<ParticleSettings | null>(
    () => {
      const { enabled, shape, colors, density, speed, size } = this.config();
      return enabled && !this.reducedMotion() ? { shape, colors, density, speed, size } : null;
    },
    { equal: sameSettings },
  );

  /** What the effect last asked for; applied as soon as the layer has a size. */
  private wanted: ParticleSettings | null = null;
  private sim: ParticleSim | null = null;
  private elements: HTMLElement[] = [];
  private frame = 0;
  private lastTime: number | null = null;
  private onScreen = typeof IntersectionObserver !== 'function';

  constructor() {
    const abort = new AbortController();
    let resize: ResizeObserver | null = null;
    let intersection: IntersectionObserver | null = null;

    afterNextRender(() => {
      if (typeof ResizeObserver === 'function') {
        resize = new ResizeObserver(() => this.resized());
        resize.observe(this.host);
      }
      if (!this.onScreen) {
        intersection = new IntersectionObserver(([entry]) => {
          this.onScreen = entry.isIntersecting;
          this.schedule();
        });
        intersection.observe(this.host);
      }
      this.document.addEventListener('visibilitychange', () => this.schedule(), {
        signal: abort.signal,
      });
      this.rendered.set(true);
    });

    effect(() => {
      if (!this.rendered()) return;
      const settings = this.settings();
      untracked(() => this.restart(settings));
    });

    inject(DestroyRef).onDestroy(() => {
      abort.abort();
      resize?.disconnect();
      intersection?.disconnect();
      this.restart(null);
    });
  }

  private restart(settings: ParticleSettings | null): void {
    this.wanted = settings;
    this.stop();
    this.host.replaceChildren();
    this.elements = [];
    this.sim = null;
    if (!settings) return;
    const bounds = this.bounds();
    if (bounds.width === 0 || bounds.height === 0) return;
    this.sim = new ParticleSim(settings, bounds);
    this.sim.particles.forEach((particle) => this.draw(particle));
    this.schedule();
  }

  private resized(): void {
    if (!this.sim) {
      // The layer had no size yet when the particles were switched on.
      if (this.wanted) this.restart(this.wanted);
      return;
    }
    this.sim.resize(this.bounds()).forEach((particle) => this.draw(particle));
    this.schedule();
  }

  private bounds() {
    const height = this.host.clientHeight;
    const viewport = this.document.defaultView?.innerHeight ?? height;
    return { width: this.host.clientWidth, height, spread: Math.min(height, viewport) };
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    if (!this.sim) return;
    const dt = this.lastTime === null ? 0 : time - this.lastTime;
    this.lastTime = time;
    this.sim.update(dt).forEach((particle) => this.draw(particle));
    this.schedule();
  };

  /** Something falls, the billet is on screen and the tab is visible. */
  private shouldRun(): boolean {
    return !!this.sim?.active && this.onScreen && !this.document.hidden;
  }

  /** Starts or stops the loop to match the state; a restart never jumps the missed time. */
  private schedule(): void {
    if (!this.shouldRun()) this.stop();
    else if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = null;
  }

  private draw(particle: Particle): void {
    const element = (this.elements[particle.id] ??= this.create(particle));
    element.style.transform = `translate(${particle.x}px, ${particle.y}px) rotate(${particle.rotation}deg)`;
    element.style.opacity = String(particle.opacity);
  }

  /** Sizes are layer pixels, like the positions the simulation computes. */
  private create(particle: Particle): HTMLElement {
    const element = this.document.createElement('div');
    Object.assign(element.style, SHAPE_STYLE[this.wanted?.shape ?? 'petal'], {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${particle.width}px`,
      height: `${particle.height}px`,
      background: particle.color,
    });
    this.host.append(element);
    return element;
  }
}
