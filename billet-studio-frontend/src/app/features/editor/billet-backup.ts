import type { BilletDocument } from '../../billet/billet-document';
import { migrateDocument } from '../../billet/migrate-document';
import { backupKey } from '../../core/services/account-backups';

/**
 * This device's copy of an account billet's unsaved edits: written before each save goes out,
 * removed once the server has them. It outlives a lost connection, a closed tab and an expired
 * session (not an explicit logout: AccountBackups), and belongs to one user, so another account on
 * this browser never sees it.
 */
export interface BilletBackup {
  /** The server version the edits were made on. */
  readonly version: number;
  /** ISO-8601 instant of the backup. */
  readonly savedAt: string;
  readonly document: BilletDocument;
}

/** The backup, its document migrated; null when there is none or it cannot be read. */
export function readBackup(userId: number, billetId: number): BilletBackup | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(backupKey(userId, billetId)) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, savedAt, document } = parsed as Record<string, unknown>;
    const migrated = migrateDocument(document);
    if (typeof version !== 'number' || typeof savedAt !== 'string' || !migrated) return null;
    return { version, savedAt, document: migrated };
  } catch {
    return null;
  }
}

/** False when this browser refuses to store it (storage full or blocked). */
export function writeBackup(
  userId: number,
  billetId: number,
  version: number,
  document: BilletDocument,
): boolean {
  const backup: BilletBackup = { version, savedAt: new Date().toISOString(), document };
  try {
    localStorage.setItem(backupKey(userId, billetId), JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

export function removeBackup(userId: number, billetId: number): void {
  try {
    localStorage.removeItem(backupKey(userId, billetId));
  } catch {
    // A key that cannot be removed could not be read either.
  }
}

/**
 * Whether a backup holds work the server copy lacks: it differs from it, and either no save has
 * reached the server since it was taken or it is younger than the server's last change.
 */
export function isNewerThan(
  backup: BilletBackup,
  server: {
    readonly version: number;
    readonly updatedAt: string;
    readonly document: BilletDocument;
  },
): boolean {
  if (JSON.stringify(backup.document) === JSON.stringify(server.document)) return false;
  return (
    backup.version === server.version || Date.parse(backup.savedAt) > Date.parse(server.updatedAt)
  );
}
