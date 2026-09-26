import { beforeEach, describe, expect, it } from 'vitest';

import { createDocument } from '../../billet/billet-document';
import { isNewerThan, readBackup, writeBackup } from './billet-backup';

describe('billet backup', () => {
  const server = {
    version: 5,
    updatedAt: '2026-05-10T08:00:00Z',
    document: createDocument({ lang: 'de' }),
  };
  const edited = { ...server.document, title: 'Mine' };

  beforeEach(() => localStorage.clear());

  it('belongs to one user and one billet', () => {
    writeBackup(7, 42, 5, edited);

    expect(readBackup(7, 42)).toMatchObject({ version: 5, document: edited });
    expect(readBackup(8, 42)).toBeNull();
    expect(readBackup(7, 43)).toBeNull();
  });

  it('is offered only when it holds edits the server copy lacks', () => {
    const backup = (version: number, savedAt: string, document = edited) => ({
      version,
      savedAt,
      document,
    });

    // Nothing reached the server since the backup was taken.
    expect(isNewerThan(backup(5, '2026-05-10T07:00:00Z'), server)).toBe(true);
    // The server moved on, but the backup is younger.
    expect(isNewerThan(backup(4, '2026-05-10T09:00:00Z'), server)).toBe(true);
    // The server moved on after the backup.
    expect(isNewerThan(backup(4, '2026-05-10T07:00:00Z'), server)).toBe(false);
    // The save arrived; only its answer did not.
    expect(isNewerThan(backup(5, '2026-05-10T09:00:00Z', server.document), server)).toBe(false);
  });
});
