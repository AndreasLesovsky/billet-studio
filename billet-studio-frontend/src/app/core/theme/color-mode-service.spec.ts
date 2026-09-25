import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColorModeService } from './color-mode-service';
import { COLOR_MODE_STORAGE_KEY } from './theme-registry.generated';

describe('ColorModeService', () => {
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

  function create(): ColorModeService {
    const service = TestBed.inject(ColorModeService);
    TestBed.tick();
    return service;
  }

  const root = () => document.documentElement;
  const storageEvent = (newValue: string | null, key: string | null = COLOR_MODE_STORAGE_KEY) =>
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

  beforeEach(() => {
    localStorage.clear();
    root().setAttribute('data-theme', 'studio');
    root().removeAttribute('data-mode');
    stubSystem(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('follows the system when nothing is stored and writes only data-mode', () => {
    stubSystem(true);
    const service = create();

    expect(service.mode()).toBe('system');
    expect(service.resolvedMode()).toBe('dark');
    expect(root().dataset['mode']).toBe('dark');
    expect(root().dataset['theme']).toBe('studio');
  });

  it('restores a stored mode and treats an unknown one as system', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    expect(create().resolvedMode()).toBe('dark');

    TestBed.resetTestingModule();
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dim');
    expect(create().mode()).toBe('system');
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
    const service = create();
    service.setMode('system');
    TestBed.tick();

    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBeNull();
    expect(root().dataset['mode']).toBe('light');
  });

  it('follows a live system change only while the mode is system', () => {
    const service = create();
    changeSystem(true);
    TestBed.tick();
    expect(root().dataset['mode']).toBe('dark');

    service.setMode('light');
    changeSystem(false);
    changeSystem(true);
    TestBed.tick();
    expect(service.resolvedMode()).toBe('light');
  });

  it('follows another tab, validated like a stored value, and a cleared storage as system', () => {
    const service = create();

    storageEvent('dark');
    expect(service.mode()).toBe('dark');

    storageEvent('<script>');
    expect(service.mode()).toBe('system');

    storageEvent('light');
    storageEvent(null, null);
    expect(service.mode()).toBe('system');
  });

  it('works with blocked storage: system on read, no throw on write', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(localStorage, 'getItem').mockImplementation(blocked);
    vi.spyOn(localStorage, 'setItem').mockImplementation(blocked);
    const service = create();

    expect(service.mode()).toBe('system');
    expect(() => service.setMode('dark')).not.toThrow();
    expect(service.resolvedMode()).toBe('dark');
  });

  it('stops listening to the system once destroyed', () => {
    const service = create();
    TestBed.resetTestingModule();
    changeSystem(true);

    expect(service.resolvedMode()).toBe('light');
  });
});
