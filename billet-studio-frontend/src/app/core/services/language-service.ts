import { computed, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export type Language = 'de' | 'en';

export const LANGUAGE_STORAGE_KEY = 'billet-studio.language';

const DEFAULT_LANGUAGE: Language = 'de';
const LOCALE_MAP: Record<Language, string> = { de: 'de-DE', en: 'en-US' };

export function isLanguage(value: unknown): value is Language {
  return value === 'de' || value === 'en';
}

/**
 * The UI language. Never inject this (or TranslateService) from anything AuthApi reaches: the
 * constructor loads a translation file through HttpClient, whose interceptors inject AuthApi.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translateService = inject(TranslateService);

  readonly availableLanguages: readonly Language[] = ['de', 'en'];

  /** The language whose file is loaded and applied. Flips only after the load, see applyLanguage. */
  readonly currentLang = signal<Language>(DEFAULT_LANGUAGE);

  /**
   * BCP 47 locale for date/number formatting ('de-DE', 'en-US'). LOCALE_ID is fixed at bootstrap, so
   * a pipe that has to follow a runtime switch passes this explicitly: `| date: 'mediumDate' : undefined : locale()`.
   */
  readonly locale = computed(() => LOCALE_MAP[this.currentLang()]);

  /** Resolves once the initial language file is loaded + applied (awaited by an app initializer). */
  private readonly ready: Promise<void>;

  constructor() {
    this.translateService.addLangs([...this.availableLanguages]);
    this.translateService.setFallbackLang(DEFAULT_LANGUAGE);
    this.ready = this.applyLanguage(this.initialLanguage());
  }

  /**
   * Bootstrap gate: app startup awaits this so the active translations are loaded BEFORE the first
   * paint. Without it, every `| translate` renders empty until the file arrives and the layout
   * shifts. fallbackLang only resolves missing keys, it does not make the first paint wait.
   */
  whenReady(): Promise<void> {
    return this.ready;
  }

  setLanguage(lang: Language): void {
    void this.applyLanguage(lang);
  }

  /** Saved choice, else the browser language when supported, else German. */
  private initialLanguage(): Language {
    const saved = readSaved();
    if (saved) return saved;
    const browser = this.translateService.getBrowserLang();
    return isLanguage(browser) ? browser : DEFAULT_LANGUAGE;
  }

  /**
   * Loads + applies a language. currentLang flips only AFTER use() has applied it, so consumers that
   * translate via instant() read the NEW language. A failed load must not hang bootstrap: keys and
   * the fallback render instead.
   */
  private applyLanguage(lang: Language): Promise<void> {
    writeSaved(lang);
    document.documentElement.lang = lang;

    return new Promise<void>((resolve) => {
      this.translateService.use(lang).subscribe({
        next: () => {
          this.currentLang.set(lang);
          resolve();
        },
        error: () => resolve(),
      });
    });
  }
}

function readSaved(): Language | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

function writeSaved(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Storage blocked: the choice lasts for this tab only.
  }
}
