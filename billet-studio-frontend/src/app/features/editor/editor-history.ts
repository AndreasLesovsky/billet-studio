import { computed, signal, type Signal, type WritableSignal } from '@angular/core';

/** Typing into the same field after a shorter pause extends the open undo step. */
export const TYPING_STEP_MS = 700;
/** Undo steps kept; the oldest go first. */
export const HISTORY_LIMIT = 100;

export interface EditorHistory<T> {
  readonly canUndo: Signal<boolean>;
  readonly canRedo: Signal<boolean>;
  /**
   * Takes in what changed since the last call. Typing into the field of the open step within
   * TYPING_STEP_MS extends that step; anything else starts a new one.
   */
  record(): void;
  /** Closes the open step, so the next change starts a new one (blur, a discrete control). */
  seal(): void;
  /** Applies `update` as a step of its own: add, move or delete a block, a theme. */
  commit(update: (current: T) => T): void;
  undo(): void;
  redo(): void;
  /** Forgets every step; the current model is the new start. */
  reset(): void;
}

export interface EditorHistoryOptions {
  readonly stepMs?: number;
  readonly limit?: number;
  readonly now?: () => number;
}

/**
 * Undo/redo for the editor's model signal. The snapshots are the model's own object references,
 * never copies: Signal Forms keep a field's identity on the objects it edits, so an undone block is
 * the same field again and its textarea keeps focus. Changes made through the form are taken in by
 * record() (the editor calls it on input and change events, and every other method records first),
 * so no write path can skip the history.
 */
export function createEditorHistory<T extends object>(
  model: WritableSignal<T>,
  { stepMs = TYPING_STEP_MS, limit = HISTORY_LIMIT, now = Date.now }: EditorHistoryOptions = {},
): EditorHistory<T> {
  const past = signal<readonly T[]>([]);
  const future = signal<readonly T[]>([]);
  /** The model as last recorded. */
  const present = signal(model());
  let openPath: string | null = null;
  let lastChangeAt = 0;

  const keep = (snapshot: T) => past.update((steps) => [...steps, snapshot].slice(-limit));

  function show(snapshot: T): void {
    present.set(snapshot);
    model.set(snapshot);
    openPath = null;
  }

  function record(): void {
    const current = model();
    const previous = present();
    if (current === previous) return;
    const path = changedPath(previous, current);
    const at = now();
    if (path === null || path !== openPath || at - lastChangeAt > stepMs) keep(previous);
    future.set([]);
    present.set(current);
    openPath = path;
    lastChangeAt = at;
  }

  return {
    canUndo: computed(() => past().length > 0 || model() !== present()),
    canRedo: computed(() => future().length > 0 && model() === present()),
    record,
    seal(): void {
      record();
      openPath = null;
    },
    commit(update): void {
      record();
      const current = present();
      const next = update(current);
      if (next === current) return;
      keep(current);
      future.set([]);
      show(next);
    },
    undo(): void {
      record();
      const steps = past();
      if (steps.length === 0) return;
      future.update((redo) => [...redo, present()]);
      past.set(steps.slice(0, -1));
      show(steps[steps.length - 1]);
    },
    redo(): void {
      record();
      const steps = future();
      if (steps.length === 0) return;
      keep(present());
      future.set(steps.slice(0, -1));
      show(steps[steps.length - 1]);
    },
    reset(): void {
      past.set([]);
      future.set([]);
      present.set(model());
      openPath = null;
    },
  };
}

export type HistoryAction = 'undo' | 'redo';

const KEY_ACTIONS: Readonly<Record<string, HistoryAction>> = {
  z: 'undo',
  'shift+z': 'redo',
  y: 'redo',
};
const INPUT_ACTIONS: Readonly<Record<string, HistoryAction>> = {
  historyUndo: 'undo',
  historyRedo: 'redo',
};

/**
 * The history's keys: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo. The browser's own
 * undo from a menu arrives as beforeinput historyUndo / historyRedo.
 */
export function historyShortcut(event: Event): HistoryAction | null {
  if (event instanceof InputEvent) return INPUT_ACTIONS[event.inputType] ?? null;
  if (!(event instanceof KeyboardEvent) || event.altKey) return null;
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = (event.shiftKey ? 'shift+' : '') + event.key.toLowerCase();
  // Cmd+Y is not redo on a Mac.
  if (key === 'y' && !event.ctrlKey) return null;
  return KEY_ACTIONS[key] ?? null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

/**
 * Where two versions differ, following changed references only: Signal Forms copy exactly the
 * objects on the path to the field they write, so one edit is one path. An array item with an `id`
 * is named by it, so a block keeps its path when it moves. Null when more than one place changed.
 */
function changedPath(before: unknown, after: unknown): string | null {
  const path: string[] = [];
  let a = before;
  let b = after;
  while (a !== b && isObject(a) && isObject(b)) {
    const [x, y] = [a, b];
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    const changed = [...keys].filter((key) => x[key] !== y[key]);
    if (changed.length !== 1) return null;
    const key = changed[0];
    const item = y[key];
    const id = Array.isArray(y) && isObject(item) ? item['id'] : undefined;
    path.push(typeof id === 'string' ? id : key);
    a = x[key];
    b = item;
  }
  return path.join('.');
}
