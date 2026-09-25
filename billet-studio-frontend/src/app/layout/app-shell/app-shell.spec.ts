import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthApi } from '../../core/services/auth-api';
import { LanguageService } from '../../core/services/language-service';
import { createMockAuthApi, translateTestingModule } from '../../../test-helpers';
import { AppShell } from './app-shell';

@Component({ template: '' })
class Page {}

// The shell's own route carries HOME in the app; here a componentless parent stands in for it.
const routes: Routes = [
  {
    path: '',
    data: { breadcrumb: 'BREADCRUMB.HOME' },
    children: [
      { path: '', component: Page },
      { path: 'account', component: Page, data: { breadcrumb: 'BREADCRUMB.ACCOUNT' } },
    ],
  },
];

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;

  const themeButton = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )!;
  const popover = () => document.getElementById('shell-theme-popover');

  async function openTheme(): Promise<void> {
    themeButton().click();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [AppShell, translateTestingModule()],
      providers: [
        provideRouter(routes),
        { provide: AuthApi, useValue: createMockAuthApi() },
        {
          provide: LanguageService,
          useValue: {
            availableLanguages: ['de', 'en'],
            currentLang: signal('de'),
            setLanguage: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AppShell);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('the theme button opens the picker as a labelled dialog and reports it expanded', async () => {
    expect(themeButton().getAttribute('aria-expanded')).toBe('false');

    await openTheme();

    expect(popover()?.getAttribute('role')).toBe('dialog');
    expect(popover()?.querySelector('app-theme-picker')).not.toBeNull();
    expect(themeButton().getAttribute('aria-expanded')).toBe('true');
    expect(themeButton().getAttribute('aria-controls')).toBe('shell-theme-popover');
  });

  it('Esc closes the picker, also from an event that carries no legacy keyCode', async () => {
    await openTheme();

    // keyCode stays 0 here, as with some assistive tech and automation; CDK alone would ignore it.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(popover()).toBeNull();
    expect(themeButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('the close button closes the picker', async () => {
    await openTheme();

    popover()!.querySelector<HTMLButtonElement>('.shell__theme-header button')!.click();
    await fixture.whenStable();

    expect(popover()).toBeNull();
  });

  it('titles the document after the current page, the home page with the site name alone', async () => {
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/account');
    await fixture.whenStable();
    expect(document.title).toBe('BREADCRUMB.ACCOUNT – billet-studio');

    await router.navigateByUrl('/');
    await fixture.whenStable();
    expect(document.title).toBe('billet-studio');
  });
});
