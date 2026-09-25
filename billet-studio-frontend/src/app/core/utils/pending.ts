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
