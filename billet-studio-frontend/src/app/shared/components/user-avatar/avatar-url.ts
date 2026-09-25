import { baseUrl } from '../../../core/environments/environment';

/**
 * The backend answers avatar paths relative to ITS origin (`/uploads/avatars/...`, served by the REST
 * service, not by this app). Absolute URLs pass through; an empty value stays empty.
 */
export function resolveAvatarUrl(
  path: string | null | undefined,
  apiUrl: string = baseUrl,
  documentUrl: string = document.baseURI,
): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const origin = new URL(apiUrl, documentUrl).origin;
  return new URL(path, origin).toString();
}
