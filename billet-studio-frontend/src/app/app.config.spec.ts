import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, LOCALE_ID, signal } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { form, FormField, required } from '@angular/forms/signals';
import { TranslateService } from '@ngx-translate/core';

import { appConfig } from './app.config';
import { LanguageService, LANGUAGE_STORAGE_KEY } from './core/services/language-service';

@Component({
  selector: 'app-probe',
  imports: [FormField],
  template: `<input [formField]="probeForm.name" />`,
})
class Probe {
  readonly model = signal({ name: '' });
  readonly probeForm = form(this.model, (p) => required(p.name, { message: 'FORMS.REQUIRED' }));
}

describe('appConfig', () => {
  let http: HttpTestingController;

  /** Boots the real providers; only the HTTP backend is a test double. */
  async function boot(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()],
    });
    // Creating the injector runs the app initializers: session restore, clock, language.
    http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === 'i18n/de.json').flush({ COMMON: { SAVE: 'Speichern' } });
    await TestBed.inject(LanguageService).whenReady();
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('loads the translations through the full interceptor chain without a DI cycle', async () => {
    // The deadlock rule: the translation request passes refreshTokenInterceptor, which injects
    // AuthApi. Anything in AuthApi's tree that injected LanguageService would make this a cycle.
    await boot();

    expect(TestBed.inject(TranslateService).instant('COMMON.SAVE')).toBe('Speichern');
  });

  it('LOCALE_ID is the locale of the language that was loaded', async () => {
    await boot();

    expect(TestBed.inject(LOCALE_ID)).toBe('de-DE');
  });

  it('an anonymous start makes no auth request at all', async () => {
    await boot();

    http.expectNone((r) => r.url.includes('auth/'));
  });

  it("the invalid class is the provider's: ui-invalid once a field is touched and invalid", async () => {
    await boot();
    const fixture = TestBed.createComponent(Probe);
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;

    expect(input.classList.contains('ui-invalid')).toBe(false);

    fixture.componentInstance.probeForm.name().markAsTouched();
    await fixture.whenStable();

    expect(input.classList.contains('ui-invalid')).toBe(true);
  });
});
