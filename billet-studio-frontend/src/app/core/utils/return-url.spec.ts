import { describe, it, expect } from 'vitest';
import { isValidReturnUrl } from './return-url';

describe('isValidReturnUrl', () => {
  it('rejects null, undefined, and empty string', () => {
    expect(isValidReturnUrl(null)).toBe(false);
    expect(isValidReturnUrl(undefined)).toBe(false);
    expect(isValidReturnUrl('')).toBe(false);
  });

  it('accepts plain relative paths', () => {
    expect(isValidReturnUrl('/')).toBe(true);
    expect(isValidReturnUrl('/billets')).toBe(true);
    expect(isValidReturnUrl('/billets/7/edit')).toBe(true);
  });

  it('accepts relative paths with query string and fragment', () => {
    expect(isValidReturnUrl('/billets/new?template=muttertag#top')).toBe(true);
    expect(isValidReturnUrl('/admin/users?page=2&q=anna')).toBe(true);
  });

  it('rejects absolute URLs', () => {
    expect(isValidReturnUrl('https://evil.com')).toBe(false);
    expect(isValidReturnUrl('http://example.com/path')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isValidReturnUrl('//evil.com')).toBe(false);
    expect(isValidReturnUrl('//evil.com/path')).toBe(false);
  });

  it('rejects backslash tricks', () => {
    expect(isValidReturnUrl('/\\evil.com')).toBe(false);
    expect(isValidReturnUrl('/\\\\evil.com')).toBe(false);
  });

  it('rejects javascript: pseudo URLs', () => {
    expect(isValidReturnUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects auth pages as return targets, with or without query and children', () => {
    expect(isValidReturnUrl('/login')).toBe(false);
    expect(isValidReturnUrl('/login?returnUrl=%2Fbillets')).toBe(false);
    expect(isValidReturnUrl('/register')).toBe(false);
    expect(isValidReturnUrl('/forgot-password')).toBe(false);
    expect(isValidReturnUrl('/reset-password/abc123')).toBe(false);
  });

  it('keeps paths that merely START with an auth word', () => {
    expect(isValidReturnUrl('/registered-billets')).toBe(true);
    expect(isValidReturnUrl('/loginwall')).toBe(true);
  });

  it('narrows the type when true', () => {
    const candidate: string | null = '/billets';
    if (isValidReturnUrl(candidate)) {
      const narrowed: string = candidate;
      expect(narrowed.length).toBeGreaterThan(0);
    }
  });
});
