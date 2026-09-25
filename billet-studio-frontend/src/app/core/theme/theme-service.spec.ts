import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COLOR_MODE_STORAGE_KEY, THEME_STORAGE_KEY } from './theme-registry.generated';
import { ThemeService } from './theme-service';

describe('ThemeService', () => {
  type ChangeListener = (e: { matches: boolean }) => void;
  let systemListener: { cb: ChangeListener; signal?: AbortSignal } | null;

  function stubSystem(dark: boolean): void {
    systemListener = null;
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: dark,
        addEventListener: (
          _type: string,
          cb: ChangeListener,
          options?: AddEventListenerOptions,
        ) => {
          systemListener = { cb, signal: options?.signal };
        },
        removeEventListener: vi.fn(),
      })),
    );
  }

  /** Fires a system colour-scheme change the way a MediaQueryList would, honouring the abort. */
  function changeSystem(dark: boolean): void {
    if (systemListener && !systemListener.signal?.aborted) systemListener.cb({ matches: dark });
  }

  function create(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  const root = () => document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute('data-theme');
    root().removeAttribute('data-mode');
    stubSystem(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts on the default theme and follows the system when nothing is stored', () => {
    stubSystem(true);
    const service = create();

    expect(service.theme()).toBe('rose');
    expect(service.mode()).toBe('system');
    expect(service.resolvedMode()).toBe('dark');
    expect(root().dataset['theme']).toBe('rose');
    expect(root().dataset['mode']).toBe('dark');
  });

  it('restores a stored theme and mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    const service = create();

    expect(service.theme()).toBe('midnight');
    expect(service.mode()).toBe('dark');
    expect(root().dataset['theme']).toBe('midnight');
    expect(root().dataset['mode']).toBe('dark');
  });

  it('falls back to the defaults for a stored theme or mode it does not know', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'bootstrap');
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dim');
    const service = create();

    expect(service.theme()).toBe('rose');
    expect(service.mode()).toBe('system');
  });

  it('setTheme switches, persists and writes data-theme', () => {
    const service = create();
    service.setTheme('sage');
    TestBed.tick();

    expect(service.theme()).toBe('sage');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('sage');
    expect(root().dataset['theme']).toBe('sage');
  });

  it('setTheme ignores an unknown id and persists nothing', () => {
    const service = create();
    service.setTheme('<script>');
    TestBed.tick();

    expect(service.theme()).toBe('rose');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root().dataset['theme']).toBe('rose');
  });

  it('an explicit mode wins over the system and is persisted', () => {
    stubSystem(true);
    const service = create();
    service.setMode('light');
    TestBed.tick();

    expect(service.resolvedMode()).toBe('light');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light');
    expect(root().dataset['mode']).toBe('light');
  });

  it("setMode('system') removes the stored mode so the boot script follows the system again", () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    stubSystem(false);
    const service = create();
    service.setMode('system');
    TestBed.tick();

    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBeNull();
    expect(service.resolvedMode()).toBe('light');
    expect(root().dataset['mode']).toBe('light');
  });

  it('follows a live system change while the mode is system', () => {
    const service = create();
    changeSystem(true);
    TestBed.tick();

    expect(service.resolvedMode()).toBe('dark');
    expect(root().dataset['mode']).toBe('dark');
  });

  it('keeps an explicit mode when the system changes', () => {
    const service = create();
    service.setMode('light');
    changeSystem(true);
    TestBed.tick();

    expect(service.resolvedMode()).toBe('light');
  });

  it('follows a theme switched in another tab, validated like a stored value', () => {
    const service = create();
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'neon' }));
    expect(service.theme()).toBe('neon');

    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'nope' }));
    expect(service.theme()).toBe('rose');

    window.dispatchEvent(
      new StorageEvent('storage', { key: COLOR_MODE_STORAGE_KEY, newValue: 'dark' }),
    );
    expect(service.mode()).toBe('dark');
  });

  it('works with blocked storage: defaults on read, no throw on write', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const service = create();

    expect(service.theme()).toBe('rose');
    expect(() => service.setTheme('paper')).not.toThrow();
    expect(service.theme()).toBe('paper');
  });

  it('stops listening to the system once destroyed', () => {
    const service = create();
    TestBed.resetTestingModule();
    changeSystem(true);

    expect(service.resolvedMode()).toBe('light');
  });
});
