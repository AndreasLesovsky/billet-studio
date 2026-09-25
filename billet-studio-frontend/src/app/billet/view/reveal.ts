import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injectable,
  input,
} from '@angular/core';

import type { BlockType } from '../billet-document';

// The live card's entrance: every element fades in or up on its own delay (TIMELINE of the card
// template). The billet root's class `billet--reveal` (bound by BilletView) switches it on; an
// element animates once RevealTimeline marks it `data-revealed`. billet-view.scss holds the
// keyframes and turns it all off under prefers-reduced-motion.

const REVEAL_CLASS = 'billet--reveal';

export interface RevealStep {
  readonly kind: 'up' | 'in';
  /** Seconds after the reveal starts. */
  readonly delay: number;
  /** Seconds. */
  readonly duration: number;
}

export const REVEAL = {
  heroLabel: { kind: 'up', delay: 0.2, duration: 0.8 },
  heroTitle: { kind: 'up', delay: 0.4, duration: 0.9 },
  heroSub: { kind: 'up', delay: 0.65, duration: 0.9 },
  scene: { kind: 'in', delay: 0.9, duration: 1.2 },
  divider: { kind: 'in', delay: 1.3, duration: 0.9 },
  signature: { kind: 'in', delay: 2.2, duration: 1 },
} as const satisfies Record<string, RevealStep>;

const BLOCKS_DELAY = 1.45;
const BLOCKS_STAGGER = 0.2;
/** Blocks from the 4th on start together, still before the signature (2.05 s < 2.2 s). */
const BLOCKS_STAGGER_CAP = 3;

/** Blocks keep their document order; notes and dividers fade in, the rest fades up. */
export function blockReveal(index: number, type: BlockType): RevealStep {
  const delay =
    Math.round((BLOCKS_DELAY + Math.min(index, BLOCKS_STAGGER_CAP) * BLOCKS_STAGGER) * 100) / 100;
  if (type === 'note') return { kind: 'in', delay, duration: 1 };
  if (type === 'divider') return { kind: 'in', delay, duration: 0.9 };
  return { kind: 'up', delay, duration: 0.9 };
}

/**
 * The clock of one billet's reveal (provided by BilletView). An element is revealed once it
 * intersects the viewport: on time it keeps its delay, seen later (below the fold, or an element
 * added afterwards) the time already passed comes off its delay, so it appears as it scrolls in.
 */
@Injectable()
export class RevealTimeline {
  private readonly root: HTMLElement = inject(ElementRef).nativeElement;
  private readonly elements = new Set<HTMLElement>();
  private observer: IntersectionObserver | null = null;
  /** Set when the first element is seen: a billet opened in a background tab starts on first view. */
  private start: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  observe(element: HTMLElement): void {
    this.elements.add(element);
    this.watch(element);
  }

  forget(element: HTMLElement): void {
    this.elements.delete(element);
    this.observer?.unobserve(element);
  }

  /** Restarts the reveal; the caller checks that the reveal is switched on. */
  replay(): void {
    this.root.classList.remove(REVEAL_CLASS);
    for (const element of this.elements) {
      this.observer?.unobserve(element);
      delete element.dataset['revealed'];
      element.style.removeProperty('--reveal-late');
    }
    // A style pass without the class, so the animations start over when it returns.
    void this.root.offsetWidth;
    this.root.classList.add(REVEAL_CLASS);
    this.start = null;
    for (const element of this.elements) this.watch(element);
  }

  private watch(element: HTMLElement): void {
    const observer = this.intersections();
    if (observer) observer.observe(element);
    else this.reveal(element);
  }

  private intersections(): IntersectionObserver | null {
    if (!this.observer && typeof IntersectionObserver === 'function') {
      this.observer = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          this.reveal(entry.target as HTMLElement);
        }
      });
    }
    return this.observer;
  }

  private reveal(element: HTMLElement): void {
    const now = performance.now();
    this.start ??= now;
    element.style.setProperty('--reveal-late', `${(now - this.start) / 1000}s`);
    element.dataset['revealed'] = element.dataset['reveal'] ?? 'in';
  }
}

/** One element of the reveal: `[appReveal]="step"`. */
@Directive({
  selector: '[appReveal]',
  host: {
    '[attr.data-reveal]': 'appReveal().kind',
    '[style.--reveal-delay]': "appReveal().delay + 's'",
    '[style.--reveal-duration]': "appReveal().duration + 's'",
  },
})
export class Reveal {
  readonly appReveal = input.required<RevealStep>();

  constructor() {
    const timeline: RevealTimeline = inject(RevealTimeline);
    const element: HTMLElement = inject(ElementRef).nativeElement;
    afterNextRender(() => timeline.observe(element));
    inject(DestroyRef).onDestroy(() => timeline.forget(element));
  }
}
