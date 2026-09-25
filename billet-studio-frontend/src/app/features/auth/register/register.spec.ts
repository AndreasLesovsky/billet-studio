import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { UserWithTokenDto } from '../../../core/models/userWithTokenDto';
import { AuthApi } from '../../../core/services/auth-api';
import { Language, LanguageService } from '../../../core/services/language-service';
import { UserApi } from '../../../core/services/user-api';
import {
  createMockActivatedRoute,
  createMockAuthApi,
  createMockRouter,
  testUser,
  translateTestingModule,
} from '../../../../test-helpers';
import { Register } from './register';

const TYPED = {
  name: 'Anna Berg',
  email: 'anna@example.com',
  password: 'Secret123',
  confirmPassword: 'Secret123',
};

function setup(
  opts: {
    returnUrl?: string;
    register?: () => Promise<unknown>;
    login?: () => Promise<UserWithTokenDto | null>;
  } = {},
) {
  const userApi = { register: vi.fn(opts.register ?? (async () => ({ id: 7 }))) };
  const authApi = createMockAuthApi();
  authApi.login.mockImplementation(opts.login ?? (async () => testUser({ id: 7 })));
  const languageService = {
    currentLang: signal<Language>('de'),
    availableLanguages: ['de', 'en'] as const,
    setLanguage: vi.fn(),
  };
  const router = createMockRouter();

  TestBed.configureTestingModule({
    imports: [Register, translateTestingModule()],
    providers: [
      { provide: UserApi, useValue: userApi },
      { provide: AuthApi, useValue: authApi },
      { provide: LanguageService, useValue: languageService },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: createMockActivatedRoute(opts.returnUrl ? { returnUrl: opts.returnUrl } : {}),
      },
    ],
  });
  TestBed.overrideComponent(Register, { set: { template: '<div></div>', imports: [] } });
  const component = TestBed.createComponent(Register).componentInstance;
  const type = (patch: Partial<typeof TYPED> = {}) =>
    component.model.update((m) => ({ ...m, ...TYPED, ...patch }));
  return { component, userApi, authApi, languageService, router, type };
}

describe('Register', () => {
  it('creates the account in the UI language, signs in and opens the billet list', async () => {
    const { component, userApi, authApi, router, type } = setup();
    type();

    await component.onSubmit(new Event('submit'));

    expect(userApi.register).toHaveBeenCalledWith({
      name: 'Anna Berg',
      email: 'anna@example.com',
      password: 'Secret123',
      preferredLanguage: 'de',
    });
    expect(authApi.login).toHaveBeenCalledWith({
      email: 'anna@example.com',
      password: 'Secret123',
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/billets');
  });

  it('returns to a safe returnUrl after signing in', async () => {
    const { component, router, type } = setup({ returnUrl: '/billets?import=1' });
    type();

    await component.onSubmit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/billets?import=1');
  });

  it('a refused sign-up neither signs in nor leaves the page', async () => {
    const { component, authApi, router, type } = setup({
      register: async () => {
        throw new Error('409 EMAIL_ALREADY_EXISTS');
      },
    });
    type();

    await component.onSubmit();

    expect(authApi.login).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('hands over to the login page, returnUrl included, when the automatic sign-in fails', async () => {
    const { component, router, type } = setup({
      returnUrl: '/account',
      login: async () => {
        throw new Error('503');
      },
    });
    type();

    await component.onSubmit();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/account' },
    });
  });

  it('an invalid form sends nothing and shows every problem', async () => {
    const { component, userApi, type } = setup();
    type({ confirmPassword: 'Secret124' });

    await component.onSubmit();

    expect(userApi.register).not.toHaveBeenCalled();
    expect(component.registerForm.confirmPassword().touched()).toBe(true);
  });

  it('the language starts on the UI language and follows the header, keeping what was typed', () => {
    const { component, languageService, type } = setup();
    expect(component.model().preferredLanguage).toBe('de');
    type();

    languageService.currentLang.set('en');

    expect(component.model()).toEqual({ ...TYPED, preferredLanguage: 'en' });
  });

  it('switches the interface to the language picked for the new account', async () => {
    const { component, languageService, type } = setup();
    type();
    component.model.update((m) => ({ ...m, preferredLanguage: 'en' }));

    await component.onSubmit();

    expect(languageService.setLanguage).toHaveBeenCalledWith('en');
  });
});
