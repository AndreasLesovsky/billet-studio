import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { AuthApi } from '../../../core/services/auth-api';
import {
  createMockAuthApi,
  createMockRouter,
  formFor,
  translateTestingModule,
} from '../../../../test-helpers';
import { ResetPassword } from './reset-password';
import { resetPasswordSchema } from './reset-password-schema';

function setup(opts: { token?: string; reset?: () => Promise<void> } = {}) {
  const authApi = createMockAuthApi();
  if (opts.reset) authApi.resetPassword.mockImplementation(opts.reset);
  const router = createMockRouter();

  TestBed.configureTestingModule({
    imports: [ResetPassword, translateTestingModule()],
    providers: [
      { provide: AuthApi, useValue: authApi },
      { provide: Router, useValue: router },
    ],
  });
  TestBed.overrideComponent(ResetPassword, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(ResetPassword);
  // The router binds ?token= to the input.
  fixture.componentRef.setInput('token', opts.token);
  return { component: fixture.componentInstance, fixture, authApi, router };
}

describe('ResetPassword', () => {
  it('sets the new password with the token from the link, then opens the login', async () => {
    const { component, authApi, router } = setup({ token: 'tok-123' });
    component.model.set({ newPassword: 'Secret123', confirmPassword: 'Secret123' });

    await component.onSubmit(new Event('submit'));

    expect(authApi.resetPassword).toHaveBeenCalledWith('tok-123', 'Secret123', 'Secret123');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('stays when the link is refused, so a new one can be requested from here', async () => {
    const { component, router } = setup({
      token: 'expired',
      reset: async () => {
        throw new Error('TOKEN_EXPIRED');
      },
    });
    component.model.set({ newPassword: 'Secret123', confirmPassword: 'Secret123' });

    await component.onSubmit();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('sends nothing without a token', async () => {
    const { component, authApi } = setup();
    component.model.set({ newPassword: 'Secret123', confirmPassword: 'Secret123' });

    await component.onSubmit();

    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('takes a new token when the URL changes while the page is kept', async () => {
    const { component, fixture, authApi } = setup({ token: 'old' });
    fixture.componentRef.setInput('token', 'new');
    component.model.set({ newPassword: 'Secret123', confirmPassword: 'Secret123' });

    await component.onSubmit();

    expect(authApi.resetPassword).toHaveBeenCalledWith('new', 'Secret123', 'Secret123');
  });

  it('sends nothing while the passwords differ', async () => {
    const { component, authApi } = setup({ token: 'tok' });
    component.model.set({ newPassword: 'Secret123', confirmPassword: 'Secret124' });

    await component.onSubmit();

    expect(authApi.resetPassword).not.toHaveBeenCalled();
    expect(component.resetForm.confirmPassword().touched()).toBe(true);
  });

  it.each([
    ['', 'AUTH.NEW_PASSWORD_REQUIRED'],
    ['Abc1', 'FORMS.MIN_LENGTH'],
    ['nouppercase1', 'AUTH.PASSWORD_REQUIREMENTS'],
  ])('the new password %j fails with %s', (newPassword, key) => {
    const { tree } = formFor({ newPassword, confirmPassword: newPassword }, resetPasswordSchema);
    expect(tree.newPassword().errors()[0]?.message).toBe(key);
  });
});
