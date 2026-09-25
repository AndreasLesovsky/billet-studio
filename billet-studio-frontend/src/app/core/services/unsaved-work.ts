import { Injectable } from '@angular/core';

export interface UnsavedWorkSource {
  /** Whether there is anything worth keeping right now. */
  isDirty: () => boolean;
  /** Whatever the form needs to come back. Opaque here - no schema, no serialization. */
  capture: () => unknown;
}

/**
 * Carries a form's work across a logout. Nothing is written anywhere: ending a session is a router
 * navigation, not a reload, so this service and its Map outlive it inside the tab - and a reload or
 * a crash takes them, which is what the beforeunload prompt is for.
 *
 * No dependencies, so AuthApi can inject it without widening the tree that must never reach
 * LanguageService (see auth-api.ts). The form-facing side lives in core/forms/keep-unsaved-work.ts,
 * which keeps that import one-way.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedWork {
  private readonly sources = new Map<string, UnsavedWorkSource>();
  private readonly kept = new Map<string, { userId: number; bundle: unknown }>();

  /** Told by AuthApi. Held here so the form side needs nothing but this service. */
  private owner: number | undefined;

  constructor() {
    window.addEventListener('beforeunload', (event) => {
      if (this.anyDirty()) event.preventDefault();
    });
  }

  register(routeKey: string, source: UnsavedWorkSource): void {
    this.sources.set(routeKey, source);
  }

  unregister(routeKey: string): void {
    this.sources.delete(routeKey);
  }

  setOwner(userId: number | undefined): void {
    this.owner = userId;
  }

  /** Called as the session ends, from every path that ends one. */
  keepAll(): void {
    if (this.owner === undefined) return;
    for (const [routeKey, source] of this.sources) {
      if (source.isDirty()) {
        this.kept.set(routeKey, { userId: this.owner, bundle: source.capture() });
      }
    }
  }

  /** Hands the work back, once. Ownership is checked here, where no new component can forget it. */
  reclaim(routeKey: string): unknown | null {
    const kept = this.kept.get(routeKey);
    this.kept.delete(routeKey);
    return kept && kept.userId === this.owner ? kept.bundle : null;
  }

  private anyDirty(): boolean {
    return [...this.sources.values()].some((source) => source.isDirty());
  }
}
