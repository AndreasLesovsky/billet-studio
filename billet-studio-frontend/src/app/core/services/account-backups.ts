import { Injectable } from '@angular/core';

const KEY_PREFIX = 'billet-studio.backup.';

/** localStorage key of one account billet's backup (features/editor/billet-backup.ts). */
export const backupKey = (userId: number, billetId: number) => `${KEY_PREFIX}${userId}.${billetId}`;

/**
 * The account editor's backups on this device, from the session's side. An explicit logout leaves
 * none of the account's behind: the open editor first sends what is pending, then every backup of
 * the account is removed. Every other end of a session (expiry, another tab, deactivation) keeps
 * them, to be offered again after the next login.
 *
 * No dependencies, so AuthApi can inject it without reaching LanguageService (see auth-api.ts);
 * the check the editor registers may ask the user.
 */
@Injectable({ providedIn: 'root' })
export class AccountBackups {
  private openEditor: (() => Promise<boolean>) | null = null;

  /**
   * The open account editor, until the returned function is called. `settle` sends what is pending
   * and resolves false when the user would rather stay signed in than lose what it could not save.
   */
  register(settle: () => Promise<boolean>): () => void {
    this.openEditor = settle;
    return () => {
      if (this.openEditor === settle) this.openEditor = null;
    };
  }

  /** Before an explicit logout, while the session still lives: false cancels the logout. */
  settleOpenEditor(): Promise<boolean> {
    return this.openEditor?.() ?? Promise.resolve(true);
  }

  /** After an explicit logout: every backup of `userId` leaves this browser. */
  removeAll(userId: number): void {
    const prefix = `${KEY_PREFIX}${userId}.`;
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
      for (const key of keys) {
        if (key?.startsWith(prefix)) localStorage.removeItem(key);
      }
    } catch {
      // Storage blocked: it holds no backup either.
    }
  }
}
