import { WritableSignal } from '@angular/core';

/**
 * Runs one user action (save, upload, delete, ...) under its own pending signal: true from the call
 * until the action settles, whatever the outcome, so its button shows the pending label and never
 * stays disabled after a failure. The result or the error passes through unchanged.
 */
export async function runPending<T>(
  pending: WritableSignal<boolean>,
  action: () => Promise<T>,
): Promise<T> {
  pending.set(true);
  try {
    return await action();
  } finally {
    pending.set(false);
  }
}

/**
 * runPending for an action offered once per item (a card's "Duplicate"): `pending` holds the key of
 * the item whose action runs, null otherwise. Callers keep the other items' buttons disabled while
 * one runs.
 */
export async function runPendingFor<K, T>(
  pending: WritableSignal<K | null>,
  key: K,
  action: () => Promise<T>,
): Promise<T> {
  pending.set(key);
  try {
    return await action();
  } finally {
    pending.set(null);
  }
}
