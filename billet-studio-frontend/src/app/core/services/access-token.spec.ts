import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccessToken, SESSION_HINT_KEY } from './access-token';

describe('AccessToken', () => {
  let accessToken: AccessToken;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AccessToken] });
    accessToken = TestBed.inject(AccessToken);
  });

  afterEach(() => localStorage.clear());

  it('keeps the token out of storage and the deadline in it', () => {
    accessToken.set('jwt', 900);

    expect(localStorage.getItem(SESSION_HINT_KEY)).not.toContain('jwt');
    expect(accessToken.endsAt()).toBeGreaterThan(Date.now());
    expect(Number(localStorage.getItem(SESSION_HINT_KEY))).toBe(accessToken.endsAt());
  });

  it('drops both halves on clear', () => {
    accessToken.set('jwt', 900);
    accessToken.clear();

    expect(accessToken.get()).toBeNull();
    expect(accessToken.endsAt()).toBeNull();
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
  });

  it('could have a session with a token in hand or a hint in storage, not without either', () => {
    expect(accessToken.couldHaveSession()).toBe(false);

    localStorage.setItem(SESSION_HINT_KEY, '');
    expect(accessToken.couldHaveSession()).toBe(true);

    localStorage.clear();
    accessToken.set('jwt');
    localStorage.clear();
    expect(accessToken.couldHaveSession()).toBe(true);
  });

  it('namespaces its hint, so another app on the same origin cannot fake or clear it', () => {
    expect(SESSION_HINT_KEY.startsWith('billet-studio.')).toBe(true);
  });

  it('adopts a deadline another tab wrote', () => {
    // What keeps a background tab from counting down to a deadline that has already moved.
    const moved = Date.now() + 30 * 60 * 1000;

    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_HINT_KEY, newValue: String(moved) }),
    );

    expect(accessToken.endsAt()).toBe(moved);
  });

  it('leaves the removal to AuthApi, which owns the logout', () => {
    accessToken.set('jwt', 900);
    const before = accessToken.endsAt();

    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_HINT_KEY, newValue: null }));

    expect(accessToken.endsAt()).toBe(before);
  });
});
