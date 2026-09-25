import { computed, DestroyRef, DOCUMENT, effect, inject, Injectable, signal } from '@angular/core';

import { COLOR_MODE_STORAGE_KEY, ColorMode } from './theme-registry.generated';

/** The user's choice; 'system' follows prefers-color-scheme live. */
export type ColorModeSetting = 'system' | ColorMode;

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark';
}

/**
 * Owns the colour mode of the site: persisted to localStorage and written to <html data-mode>.
 * theme-boot.js sets data-mode (and the fixed site theme, data-theme) before the first paint, so
 * this service only takes over for switching and for following the system live.
 *
 * It never writes data-theme: the site has exactly one theme, and editor themes are scoped to their
 * own elements (ThemeScope), which read resolvedMode() as their default.
 */
@Injectable({ providedIn: 'root' })
export class ColorModeService {
  private readonly document = inject(DOCUMENT);

  private readonly modeState = signal<ColorModeSetting>(parseMode(readStoredMode()));
  private readonly systemDark = signal(false);

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

    // Another tab switched the mode or cleared the storage (key null): follow it, validated like
    // any stored value.
    view?.addEventListener(
      'storage',
      (e) => {
        if (e.key === COLOR_MODE_STORAGE_KEY || e.key === null) {
          this.modeState.set(parseMode(e.newValue));
        }
      },
      { signal: abort.signal },
    );

    effect(() => this.document.documentElement.setAttribute('data-mode', this.resolvedMode()));
  }

  /** 'system' removes the stored mode, so theme-boot.js follows the system on the next load too. */
  setMode(mode: ColorModeSetting): void {
    if (mode !== 'system' && !isColorMode(mode)) return;
    this.modeState.set(mode);
    try {
      if (mode === 'system') localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
      else localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage blocked: the choice lasts for this tab only.
    }
  }
}

function parseMode(value: string | null): ColorModeSetting {
  return isColorMode(value) ? value : 'system';
}

function readStoredMode(): string | null {
  try {
    return localStorage.getItem(COLOR_MODE_STORAGE_KEY);
  } catch {
    return null;
  }
}
