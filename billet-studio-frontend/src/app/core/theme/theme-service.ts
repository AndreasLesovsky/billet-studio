import { computed, DestroyRef, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';

import {
  COLOR_MODE_STORAGE_KEY,
  ColorMode,
  DEFAULT_THEME,
  isThemeId,
  THEME_STORAGE_KEY,
  ThemeId,
} from './theme-registry.generated';

/** The user's choice; 'system' follows prefers-color-scheme live. */
export type ColorModeSetting = 'system' | ColorMode;

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark';
}

/**
 * Owns the editor theme: a validated theme id and the colour mode, persisted to localStorage and
 * written to <html data-theme data-mode>. theme-boot.js sets the same attributes before the first
 * paint, so this service only takes over for switching and for following the system live.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  private readonly themeState = signal<ThemeId>(readTheme());
  private readonly modeState = signal<ColorModeSetting>(readMode());
  private readonly systemDark = signal(false);

  readonly theme = this.themeState.asReadonly();
  readonly mode = this.modeState.asReadonly();
  readonly resolvedMode = computed<ColorMode>(() => {
    const mode = this.modeState();
    if (mode !== 'system') return mode;
    return this.systemDark() ? 'dark' : 'light';
  });

  constructor() {
    const view = this.document.defaultView;
    const abort = new AbortController();
    inject(DestroyRef).onDestroy(() => abort.abort());

    const query = view?.matchMedia?.(DARK_QUERY);
    if (query) {
      this.systemDark.set(query.matches);
      query.addEventListener('change', (e) => this.systemDark.set(e.matches), {
        signal: abort.signal,
      });
    }

    // Another tab switched the theme: follow it, validated like any stored value.
    view?.addEventListener(
      'storage',
      (e) => {
        if (e.key === THEME_STORAGE_KEY) this.themeState.set(parseTheme(e.newValue));
        if (e.key === COLOR_MODE_STORAGE_KEY) this.modeState.set(parseMode(e.newValue));
      },
      { signal: abort.signal },
    );

    effect(() => {
      const root = this.document.documentElement;
      root.setAttribute('data-theme', this.themeState());
      root.setAttribute('data-mode', this.resolvedMode());
    });
  }

  /** Switches to a known theme; anything else is ignored. */
  setTheme(id: string): void {
    if (!isThemeId(id)) return;
    this.themeState.set(id);
    writeStorage(THEME_STORAGE_KEY, id);
  }

  /** 'system' removes the stored mode, so theme-boot.js follows the system on the next load too. */
  setMode(mode: ColorModeSetting): void {
    if (mode !== 'system' && !isColorMode(mode)) return;
    this.modeState.set(mode);
    writeStorage(COLOR_MODE_STORAGE_KEY, mode === 'system' ? null : mode);
  }
}

function parseTheme(value: string | null): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

function parseMode(value: string | null): ColorModeSetting {
  return isColorMode(value) ? value : 'system';
}

function readTheme(): ThemeId {
  return parseTheme(readStorage(THEME_STORAGE_KEY));
}

function readMode(): ColorModeSetting {
  return parseMode(readStorage(COLOR_MODE_STORAGE_KEY));
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this tab only.
  }
}
