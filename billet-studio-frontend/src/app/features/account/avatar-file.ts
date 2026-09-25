/** What POST /v1/account/avatar accepts (api-contract: jpg/png/gif/bmp/webp/avif, max 20 MB). */
export const AVATAR_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/avif',
];
export const AVATAR_MAX_MB = 20;

// Windows reports BMP as image/x-ms-bmp and some systems give no type at all; the extension decides
// then. The server checks the content either way.
const AVATAR_EXTENSION = /\.(jpe?g|png|gif|bmp|webp|avif)$/i;
const AVATAR_MAX_BYTES = AVATAR_MAX_MB * 1024 * 1024;

export interface AvatarFileProblem {
  /** A MESSAGES.WARNING code. */
  code: 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE';
  params?: Record<string, unknown>;
}

/** Why a picked or dropped file cannot become the avatar, or null when it can. */
export function avatarFileProblem(file: File): AvatarFileProblem | null {
  if (!AVATAR_TYPES.includes(file.type) && !AVATAR_EXTENSION.test(file.name)) {
    return { code: 'INVALID_IMAGE' };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { code: 'IMAGE_TOO_LARGE', params: { maxMb: AVATAR_MAX_MB } };
  }
  return null;
}
