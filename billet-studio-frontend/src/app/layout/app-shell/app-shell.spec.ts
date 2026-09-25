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
