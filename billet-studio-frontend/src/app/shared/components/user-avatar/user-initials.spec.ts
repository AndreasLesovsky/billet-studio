import { describe, expect, it } from 'vitest';

import { getUserInitials } from './user-initials';

describe('getUserInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(getUserInitials('Anna Berger')).toBe('AB');
    expect(getUserInitials('a b c')).toBe('AB');
  });

  it('takes the first two letters of a single word', () => {
    expect(getUserInitials('Anna')).toBe('AN');
    expect(getUserInitials('A')).toBe('A');
  });

  it('collapses extra whitespace', () => {
    expect(getUserInitials('  Anna   Berger ')).toBe('AB');
  });

  it('falls back to the local part of the email when there is no name', () => {
    expect(getUserInitials(null, 'info@billet-studio.app')).toBe('IN');
    expect(getUserInitials('   ', 'x@y.z')).toBe('X');
  });

  it('never splits a character outside the basic plane', () => {
    expect(getUserInitials('𝒜nna')).toBe('𝒜N');
  });

  it('is empty when nothing is usable', () => {
    expect(getUserInitials()).toBe('');
    expect(getUserInitials('', '')).toBe('');
  });
});
