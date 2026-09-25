import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { UserWithTokenDto } from '../../../core/models/userWithTokenDto';
import { AuthApi } from '../../../core/services/auth-api';
import {
  createMockActivatedRoute,
  createMockAuthApi,
  createMockRouter,
  testUser,
  translateTestingModule,
} from '../../../../test-helpers';
import { Login } from './login';

const VALID = { email: 'anna@example.com', password: 'whatever' };

function setup(opts: {
  returnUrl?: string;
  login?: () => Promise<UserWithTokenDto | null>;
  belongs?: boolean;
}) {
  const authApi = createMockAuthApi();
  authApi.login.mockImplementation(opts.login ?? (async () => testUser({ id: 7 })));
  authApi.returnUrlBelongsTo.mockReturnValue(opts.belongs ?? true);
  const router = createMockRouter();

  TestBed.configureTestingModule({
    imports: [Login, translateTestingModule()],
    providers: [
      { provide: AuthApi, useValue: authApi },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: createMockActivatedRoute(opts.returnUrl ? { returnUrl: opts.returnUrl } : {}),
      },
    ],
  });
  TestBed.overrideComponent(Login, { set: { template: '<div></div>', imports: [] } });
  const component = TestBed.createComponent(Login).componentInstance;
  return { component, authApi, router };
}

describe('Login', () => {
  it('signs in with the typed credentials and follows a returnUrl that is theirs', async () => {
    const { component, authApi, router } = setup({ returnUrl: '/account' });
    component.model.set(VALID);

    await component.onSubmit(new Event('submit'));

    expect(authApi.login).toHaveBeenCalledWith(VALID);
    expect(authApi.returnUrlBelongsTo).toHaveBeenCalledWith('/account', 7);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });

  it('lands on the billet list without a returnUrl', async () => {
    const { component, router } = setup({});
    component.model.set(VALID);

    await component.onSubmit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/billets');
  });

  it('lands on the billet list when the returnUrl leaves the app', async () => {
    const { component, router } = setup({ returnUrl: '//evil.example/steal' });
    component.model.set(VALID);

    await component.onSubmit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/billets');
  });

  it("lands on the billet list when the returnUrl is another account's expired page", async () => {
    const { component, router } = setup({ returnUrl: '/admin/users', belongs: false });
    component.model.set(VALID);

    await component.onSubmit();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/billets');
  });

  it('stays on the page when the credentials are refused', async () => {
    const { component, router } = setup({
      login: async () => {
        throw new Error('401');
      },
    });
    component.model.set(VALID);

    await component.onSubmit();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.model()).toEqual(VALID);
  });

  it('stays on the page when the answer carries no session', async () => {
    const { component, router } = setup({ login: async () => null });
    component.model.set(VALID);

    await component.onSubmit();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('an incomplete form sends nothing and shows every problem', async () => {
    const { component, authApi } = setup({});
    component.model.set({ email: 'anna@example.com', password: '' });
    const preventDefault = vi.fn();

    await component.onSubmit({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalled();
    expect(authApi.login).not.toHaveBeenCalled();
    expect(component.loginForm.password().touched()).toBe(true);
  });
});
