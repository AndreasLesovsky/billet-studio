import { describe, expect, it } from 'vitest';

import { fileOf } from '../../../test-helpers';
import { AVATAR_MAX_MB, avatarFileProblem } from './avatar-file';

const MB = 1024 * 1024;

describe('avatarFileProblem', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/avif'])(
    'accepts %s',
    (type) => {
      expect(avatarFileProblem(fileOf(MB, type))).toBeNull();
    },
  );

  it('accepts a known extension when the system reports no or an odd type', () => {
    expect(avatarFileProblem(new File([''], 'me.BMP', { type: 'image/x-ms-bmp' }))).toBeNull();
    expect(avatarFileProblem(new File([''], 'me.avif', { type: '' }))).toBeNull();
  });

  it('refuses what is not an image', () => {
    expect(avatarFileProblem(new File([''], 'notes.pdf', { type: 'application/pdf' }))).toEqual({
      code: 'INVALID_IMAGE',
    });
  });

  it('refuses an image over the limit and says the limit', () => {
    expect(avatarFileProblem(fileOf(AVATAR_MAX_MB * MB + 1))).toEqual({
      code: 'IMAGE_TOO_LARGE',
      params: { maxMb: AVATAR_MAX_MB },
    });
  });

  it('accepts an image of exactly the limit', () => {
    expect(avatarFileProblem(fileOf(AVATAR_MAX_MB * MB))).toBeNull();
  });
});
