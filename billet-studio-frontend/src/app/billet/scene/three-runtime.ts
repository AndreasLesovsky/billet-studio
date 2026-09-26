import { Injectable } from '@angular/core';

/** The lazy three.js chunk: three, the five add-ons the scene uses and the stage built on them. */
export type ThreeBundle = typeof import('./three-bundle');

/**
 * Loads the three.js chunk on first use. Nothing outside `three-bundle.ts` and the stage modules
 * behind it (`scene-stage.ts`, `stage-runtime.ts`, `stage-environment.ts`) and the home hero's lazy
 * chunk (`features/home/hero-story/hero-runtime.ts`) may import three at runtime (type imports
 * only), or it leaves the lazy chunk.
 */
@Injectable({ providedIn: 'root' })
export class ThreeRuntime {
  private bundle: Promise<ThreeBundle> | null = null;

  /** One import per session; a failed import (offline, new deploy) is retried on the next call. */
  load(): Promise<ThreeBundle> {
    if (!this.bundle) {
      const pending = import('./three-bundle');
      this.bundle = pending;
      pending.catch(() => {
        if (this.bundle === pending) this.bundle = null;
      });
    }
    return this.bundle;
  }
}
