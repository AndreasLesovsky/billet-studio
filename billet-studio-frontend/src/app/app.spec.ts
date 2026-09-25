import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from './app.routes';
import { AccessToken } from './core/services/access-token';
import { AuthApi } from './core/services/auth-api';
import { LanguageService } from './core/services/language-service';
import {
  createMockAccessToken,
  createMockAuthApi,
  testUser,
  translateTestingModule,
} from '../test-helpers';

function keysOf(file: string): Set<string> {
  const flat = new Set<string>();
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, path);
      else flat.add(path);
    }
  };
  walk(JSON.parse(readFileSync(join('public', 'i18n', file), 'utf8')), '');
  return flat;
}

/** Every route that renders a page, with the breadcrumb key it answers to. */
function pages(list: Routes, parent: Route | null = null): { route: Route; key: unknown }[] {
  return list.flatMap((route) => {
    const own = route.data?.['breadcrumb'];
    const page = route.loadComponent && !route.children ? [{ route, key: own }] : [];
    // An index child ('') is its parent's page and answers to the parent's crumb.
    const indexed = page.map((p) =>
      route.path === '' && parent ? { ...p, key: own ?? parent.data?.['breadcrumb'] } : p,
    );
    return [...indexed, ...pages(route.children ?? [], route)];
  });
}

describe('app routes', () => {
  function configure(auth = createMockAuthApi()): void {
    TestBed.configureTestingModule({
      imports: [translateTestingModule()],
      providers: [
        provideRouter(routes),
        { provide: AuthApi, useValue: auth },
        { provide: AccessToken, useValue: createMockAccessToken() },
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
  }

  beforeEach(() => configure());

  it('renders the home page inside the app shell', async () => {
    const harness = await RouterTestingHarness.create('/');

    expect(harness.routeNativeElement?.tagName).toBe('APP-SHELL');
    expect(harness.routeNativeElement?.querySelector('app-home')).not.toBeNull();
  });

  it('answers an unknown path with the not-found page and its crumb', async () => {
    const harness = await RouterTestingHarness.create('/nowhere/at/all');

    const shell = harness.routeNativeElement!;
    expect(shell.querySelector('app-not-found')).not.toBeNull();
    expect(shell.querySelector('[aria-current="page"]')?.textContent).toContain(
      'BREADCRUMB.NOT_FOUND',
    );
  });

  it('renders a share link without any app chrome', async () => {
    const harness = await RouterTestingHarness.create('/b/AbCdEfGhIjKlMnOpQrStUv');

    const page = harness.routeNativeElement!;
    expect(page.tagName).toBe('APP-BARE-LAYOUT');
    expect(page.querySelector('.ui-app-header, app-breadcrumb, .ui-app-footer')).toBeNull();
    expect(page.querySelector('app-not-found')).not.toBeNull();
  });

  it('keeps My billets open to guests', async () => {
    const harness = await RouterTestingHarness.create('/billets');

    expect(harness.routeNativeElement?.querySelector('app-billet-list')).not.toBeNull();
  });

  it('sends a guest from the account page to the login, with the way back', async () => {
    await RouterTestingHarness.create('/account');

    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Faccount');
  });

  it('sends a signed-in non-admin away from the user management', async () => {
    TestBed.resetTestingModule();
    configure(createMockAuthApi({ user: testUser({ role: 'ROLE_USER' }) }));

    await RouterTestingHarness.create('/admin/users');

    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('every page in the shell answers to a breadcrumb key that exists in both languages', () => {
    const de = keysOf('de.json');
    const en = keysOf('en.json');
    const shell = routes.find((r) => r.data?.['breadcrumb'] === 'BREADCRUMB.HOME')!;

    const missing = pages(shell.children ?? [], shell)
      .filter(({ key }) => typeof key !== 'string' || !de.has(key) || !en.has(key))
      .map(({ route, key }) => `${route.path}: ${String(key)}`);

    expect(missing).toEqual([]);
  });
});
