import { computed, Signal, signal, WritableSignal } from '@angular/core';

export interface ModelUndo {
  /** True when the model differs from the last saved snapshot (also the "dirty" check). */
  readonly canUndo: Signal<boolean>;
  /** Capture the current model as the baseline (after load + after a successful save). */
  saveSnapshot(): void;
  /** Restore the model to the last snapshot. */
  undo(): void;
}

/**
 * Snapshot-based undo for a Signal-Forms model signal. With the form state living in one signal, undo
 * is just `model.set(snapshot)` and dirty is a plain value comparison - no valueChanges plumbing.
 */
export function createModelUndo<T>(model: WritableSignal<T>): ModelUndo {
  const snapshot = signal<T | null>(null);

  const canUndo = computed(() => {
    const snap = snapshot();
    return snap !== null && JSON.stringify(model()) !== JSON.stringify(snap);
  });

  return {
    canUndo,
    saveSnapshot(): void {
      snapshot.set(structuredClone(model()));
    },
    undo(): void {
      const snap = snapshot();
      if (snap !== null) {
        model.set(structuredClone(snap));
      }
    },
  };
}
