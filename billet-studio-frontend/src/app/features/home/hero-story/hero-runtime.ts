import { Injectable } from '@angular/core';

/** The lazy hero chunk: the story stage, its rig, its display shader. */
export type HeroBundle = typeof import('./hero-bundle');

/**
 * Loads the hero chunk on first use, like ThreeRuntime loads the billet scene's. Nothing outside
 * `hero-bundle.ts` and the modules behind it (`hero-stage.ts`, `hero-rig.ts`,
 * `hero-screen-material.ts`) may import three at runtime (type imports only), or it leaves the lazy
 * chunk.
 */
@Injectable({ providedIn: 'root' })
export class HeroRuntime {
  private bundle: Promise<HeroBundle> | null = null;

  /** One import per session; a failed import (offline, new deploy) is retried on the next call. */
  load(): Promise<HeroBundle> {
    if (!this.bundle) {
      const pending = import('./hero-bundle');
      this.bundle = pending;
      pending.catch(() => {
        if (this.bundle === pending) this.bundle = null;
      });
    }
    return this.bundle;
  }
}
