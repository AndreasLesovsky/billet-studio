import type { BilletDocument, HexColor, ParticleShape } from '../billet-document';

// The falling particles of a billet, without the DOM: the live card's petal loop and the card
// template's shape presets, in layer pixels. Motion is a closed form of the particle's age, and age
// advances by wall time normalised to 60 fps frames, so 60 Hz and 120 Hz land on the same positions.

type Range = readonly [min: number, max: number];

interface ParticleShapePreset {
  /** Height / width. */
  readonly aspectRatio: number;
  /** Factor on the base spin of ±0.25°/frame. */
  readonly spin: number;
  /** px per frame. */
  readonly fallSpeed: Range;
  /** px per frame. */
  readonly wobbleAmp: Range;
  /** rad per frame. */
  readonly wobbleSpeed: Range;
  /** Width in px at size 1. */
  readonly size: Range;
}

/** petal..confetti: digital-card-template PARTICLE_SHAPES; the petal size is the live card's. */
const PARTICLE_SHAPE_PRESETS: Readonly<Record<ParticleShape, ParticleShapePreset>> = {
  petal: {
    aspectRatio: 1.5,
    spin: 1,
    fallSpeed: [0.18, 0.43],
    wobbleAmp: [0.2, 0.5],
    wobbleSpeed: [0.006, 0.012],
    size: [9, 22],
  },
  snowflake: {
    aspectRatio: 1,
    spin: 0.25,
    fallSpeed: [0.08, 0.2],
    wobbleAmp: [0.6, 1.1],
    wobbleSpeed: [0.003, 0.007],
    size: [4, 10],
  },
  leaf: {
    aspectRatio: 1.8,
    spin: 1.6,
    fallSpeed: [0.18, 0.45],
    wobbleAmp: [0.4, 0.8],
    wobbleSpeed: [0.007, 0.013],
    size: [8, 16],
  },
  confetti: {
    aspectRatio: 0.4,
    spin: 2.5,
    fallSpeed: [0.3, 0.6],
    wobbleAmp: [0.5, 0.9],
    wobbleSpeed: [0.008, 0.018],
    size: [8, 16],
  },
  heart: {
    aspectRatio: 1,
    spin: 0.3,
    fallSpeed: [0.12, 0.3],
    wobbleAmp: [0.3, 0.6],
    wobbleSpeed: [0.004, 0.009],
    size: [10, 18],
  },
};

export interface ParticleBudget {
  /** The first wave. */
  readonly count: number;
  /** New particles spawn while fewer than this are falling... */
  readonly inAirMax: number;
  /** ...until this many exist in total. */
  readonly totalCap: number;
}

/** docs/billet-document.md, "Density mapping": 50 is the live card (28 / 12 / 84). */
export function particleBudget(density: number): ParticleBudget {
  const count = Math.round(Math.min(100, Math.max(0, density)) * 0.56);
  return { count, inAirMax: Math.round(count * 0.43), totalCap: count * 3 };
}

export type ParticleSettings = Omit<BilletDocument['particles'], 'enabled'>;

export interface ParticleBounds {
  readonly width: number;
  /** Particles settle at this height, minus their own. */
  readonly height: number;
  /** The first wave starts up to this far above the top. */
  readonly spread: number;
}

export interface Particle {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly color: HexColor;
  readonly x: number;
  readonly y: number;
  /** Degrees. */
  readonly rotation: number;
  readonly opacity: number;
  readonly settled: boolean;
}

const FRAME_MS = 1000 / 60;
/** A stalled frame (debugger, busy main thread) never fast-forwards the fall. */
const MAX_STEP_MS = 100;
const SNAP_DEGREES = 15;
/** Absorbs float drift, so a spawn due exactly at a frame boundary happens there at any rate. */
const EPSILON = 1e-9;

type MutableParticle = { -readonly [K in keyof Particle]: Particle[K] };

interface SimParticle extends MutableParticle {
  /** Frames since spawn at speed 1. */
  age: number;
  readonly x0: number;
  readonly y0: number;
  readonly vx: number;
  readonly vy: number;
  readonly rotation0: number;
  readonly spin: number;
  readonly wobbleOffset: number;
  readonly wobbleSpeed: number;
  readonly wobbleAmp: number;
  readonly settledOpacity: number;
}

export class ParticleSim {
  private readonly items: SimParticle[] = [];
  private readonly budget: ParticleBudget;
  private readonly preset: ParticleShapePreset;
  private inAir = 0;
  /** Frames towards the next spawn opportunity: at most one per frame, like the live card. */
  private spawnClock = 0;

  constructor(
    private readonly settings: ParticleSettings,
    private bounds: ParticleBounds,
    private readonly random: () => number = Math.random,
  ) {
    this.budget = particleBudget(settings.density);
    this.preset = PARTICLE_SHAPE_PRESETS[settings.shape] ?? PARTICLE_SHAPE_PRESETS.petal;
    for (let i = 0; i < this.budget.count; i++) this.spawn(true);
  }

  get particles(): readonly Particle[] {
    return this.items;
  }

  /** False once everything has settled and nothing may spawn: the loop can stop. */
  get active(): boolean {
    return this.inAir > 0 || this.canSpawn();
  }

  /**
   * Moves the falling particles by `dtMs` of wall time and answers the ones that changed. Spawns
   * are decided at every whole frame of sim time, with every particle advanced to that moment, so
   * the frame rate never changes an outcome.
   */
  update(dtMs: number): Particle[] {
    let frames = (Math.min(Math.max(0, dtMs), MAX_STEP_MS) / FRAME_MS) * this.settings.speed;
    const changed: Particle[] = this.items.filter((particle) => !particle.settled);
    while (this.spawnClock + frames >= 1 - EPSILON) {
      const step = Math.max(0, 1 - this.spawnClock);
      this.advanceAll(step);
      frames = Math.max(0, frames - step);
      this.spawnClock = 0;
      if (this.canSpawn()) changed.push(this.spawn(false));
    }
    this.advanceAll(frames);
    this.spawnClock += frames;
    return changed;
  }

  /** A new layer size: settled particles move onto the new floor; answers the ones that moved. */
  resize(bounds: ParticleBounds): Particle[] {
    this.bounds = bounds;
    const moved: Particle[] = [];
    for (const particle of this.items) {
      const floor = this.floor(particle);
      if (particle.settled && particle.y !== floor) {
        particle.y = floor;
        moved.push(particle);
      }
    }
    return moved;
  }

  private canSpawn(): boolean {
    return this.inAir < this.budget.inAirMax && this.items.length < this.budget.totalCap;
  }

  private floor(particle: SimParticle): number {
    return this.bounds.height - particle.height;
  }

  private spawn(initial: boolean): SimParticle {
    const { preset, random } = this;
    const between = ([min, max]: Range) => min + random() * (max - min);
    const { colors } = this.settings;
    const width = between(preset.size) * this.settings.size;
    const height = width * preset.aspectRatio;
    const color = colors[Math.floor(random() * colors.length)] ?? '';
    const x0 = random() * this.bounds.width;
    const y0 = initial ? random() * -this.bounds.spread : -height - 10;
    const particle: SimParticle = {
      id: this.items.length,
      width,
      height,
      color,
      x: x0,
      y: y0,
      rotation: 0,
      settled: false,
      age: 0,
      x0,
      y0,
      vy: between(preset.fallSpeed),
      vx: (random() - 0.5) * 0.2,
      rotation0: random() * 360,
      spin: (random() - 0.5) * 0.5 * preset.spin,
      wobbleOffset: random() * Math.PI * 2,
      wobbleSpeed: between(preset.wobbleSpeed),
      wobbleAmp: between(preset.wobbleAmp),
      // Drawn now, not on landing: the random sequence must not depend on when a frame lands.
      opacity: 0.55 + random() * 0.3,
      settledOpacity: 0.35 + random() * 0.2,
    };
    this.place(particle);
    this.items.push(particle);
    this.inAir++;
    return particle;
  }

  private advanceAll(frames: number): void {
    for (const particle of this.items) {
      if (!particle.settled) this.advance(particle, frames);
    }
  }

  private advance(particle: SimParticle, frames: number): void {
    const previous = particle.age;
    particle.age += frames;
    const landing = (this.floor(particle) - particle.y0) / particle.vy;
    if (particle.age >= landing) {
      // Lands at the exact crossing, never behind where it already was (a floor that moved up).
      particle.age = Math.max(previous, landing);
      particle.settled = true;
      this.inAir--;
    }
    this.place(particle);
  }

  /** The closed form of the live card's per-frame steps: x += vx + sin(tick·ws + off)·amp. */
  private place(particle: SimParticle): void {
    const { age, wobbleSpeed, wobbleOffset } = particle;
    const sway =
      (particle.wobbleAmp / wobbleSpeed) *
      (Math.cos(wobbleOffset) - Math.cos(wobbleSpeed * age + wobbleOffset));
    particle.x = particle.x0 + particle.vx * age + sway;
    const rotation = particle.rotation0 + particle.spin * age;
    if (particle.settled) {
      particle.y = this.floor(particle);
      particle.rotation = Math.round(rotation / SNAP_DEGREES) * SNAP_DEGREES;
      particle.opacity = particle.settledOpacity;
    } else {
      particle.y = particle.y0 + particle.vy * age;
      particle.rotation = rotation;
    }
  }
}
