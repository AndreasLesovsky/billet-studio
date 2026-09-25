// Header links pass the CURRENT url as returnUrl, which can be an auth page itself - and returning
// to /login or /register after logging in is a loop, never a destination.
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

/** A same-origin, in-app path that is safe to navigate to after a login. */
export function isValidReturnUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  if (!url.startsWith('/')) return false;
  // Block protocol-relative URLs (//evil.com) and backslash tricks (/\evil.com)
  if (url.startsWith('//') || url.startsWith('/\\')) return false;
  if (
    AUTH_PAGES.some(
      (page) => url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}/`),
    )
  ) {
    return false;
  }
  return true;
}
