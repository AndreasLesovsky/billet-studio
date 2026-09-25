import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';

import { LANGUAGE_STORAGE_KEY, LanguageService } from './language-service';

describe('LanguageService', () => {
  let translate: {
    use: ReturnType<typeof vi.fn>;
    addLangs: ReturnType<typeof vi.fn>;
    setFallbackLang: ReturnType<typeof vi.fn>;
    getBrowserLang: ReturnType<typeof vi.fn>;
  };

  function create(): LanguageService {
    TestBed.configureTestingModule({
      providers: [LanguageService, { provide: TranslateService, useValue: translate }],
    });
    return TestBed.inject(LanguageService);
  }

  beforeEach(() => {
    localStorage.clear();
    translate = {
      use: vi.fn(() => of({})),
      addLangs: vi.fn(),
      setFallbackLang: vi.fn(() => of({})),
      getBrowserLang: vi.fn(() => 'de'),
    };
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'de';
  });

  it('starts on de, with de as the fallback, and requests it via use() during init', () => {
    const service = create();

    expect(service.currentLang()).toBe('de');
    expect(service.locale()).toBe('de-DE');
    expect(translate.setFallbackLang).toHaveBeenCalledWith('de');
    expect(translate.use).toHaveBeenCalledWith('de');
  });

  // The app initializer awaits whenReady() (the loaded case is app.config.spec.ts's boot).
  it('whenReady() also resolves when the file fails to load, so bootstrap never hangs', async () => {
    translate.use.mockReturnValue(throwError(() => new Error('404')));

    await expect(create().whenReady()).resolves.toBeUndefined();
  });

  it('a saved choice wins over the browser language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    translate.getBrowserLang.mockReturnValue('de');

    const service = create();

    expect(translate.use).toHaveBeenCalledWith('en');
    expect(service.currentLang()).toBe('en');
    expect(service.locale()).toBe('en-US');
  });

  it('follows a supported browser language when nothing is saved', () => {
    translate.getBrowserLang.mockReturnValue('en');

    expect(create().currentLang()).toBe('en');
  });

  it('falls back to German for an unsupported browser language or a garbled saved value', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    translate.getBrowserLang.mockReturnValue('fr');

    create();

    expect(translate.use).toHaveBeenCalledWith('de');
  });

  // Regression: currentLang must flip only AFTER use() has applied the language, so consumers that
  // translate via instant() read the NEW language, not synchronously in setLanguage.
  it('flips currentLang only after use() resolves (the language file is loaded + applied)', () => {
    const service = create();
    const applied = new Subject<object>();
    translate.use.mockReturnValue(applied);

    service.setLanguage('en');

    expect(translate.use).toHaveBeenCalledWith('en');
    expect(service.currentLang()).toBe('de');

    applied.next({});
    expect(service.currentLang()).toBe('en');
  });

  it('remembers the choice and sets the document language', () => {
    const service = create();

    service.setLanguage('en');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
