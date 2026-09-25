import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Language, LanguageService } from '../../../core/services/language-service';
import { translateTestingModule } from '../../../../test-helpers';
import { LanguageSwitch } from './language-switch';

describe('LanguageSwitch', () => {
  let fixture: ComponentFixture<LanguageSwitch>;
  const current = signal<Language>('de');
  const setLanguage = vi.fn();

  const radios = () => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input'),
  ];

  beforeEach(async () => {
    current.set('de');
    setLanguage.mockReset();
    TestBed.configureTestingModule({
      imports: [LanguageSwitch, translateTestingModule()],
      providers: [
        {
          provide: LanguageService,
          useValue: { availableLanguages: ['de', 'en'], currentLang: current, setLanguage },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', { NAV: { LANGUAGE_DE: 'Deutsch', LANGUAGE_EN: 'English' } });
    translate.use('de');
    fixture = TestBed.createComponent(LanguageSwitch);
    await fixture.whenStable();
  });

  it('checks the language that is loaded', () => {
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
  });

  it('names each option in its own language, which starts with the visible code', () => {
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('label')];
    const text = (label: Element, selector: string) =>
      label.querySelector(selector)?.textContent?.trim();

    expect(
      labels.map((l) => [l.lang, text(l, '[aria-hidden="true"]'), text(l, '.ui-visually-hidden')]),
    ).toEqual([
      ['de', 'DE', 'Deutsch'],
      ['en', 'EN', 'English'],
    ]);
  });

  it('switches the UI language on selection', () => {
    radios()[1].click();

    expect(setLanguage).toHaveBeenCalledWith('en');
  });
});
