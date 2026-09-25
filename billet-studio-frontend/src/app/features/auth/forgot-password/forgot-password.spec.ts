import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { AuthApi } from '../../../core/services/auth-api';
import { createMockAuthApi, translateTestingModule } from '../../../../test-helpers';
import { ForgotPassword } from './forgot-password';

function setup(forgot?: () => Promise<void>) {
  const authApi = createMockAuthApi();
  if (forgot) authApi.forgotPassword.mockImplementation(forgot);

  TestBed.configureTestingModule({
    imports: [ForgotPassword, translateTestingModule()],
    providers: [{ provide: AuthApi, useValue: authApi }],
  });
  TestBed.overrideComponent(ForgotPassword, { set: { template: '<div></div>', imports: [] } });
  const component = TestBed.createComponent(ForgotPassword).componentInstance;
  return { component, authApi };
}

describe('ForgotPassword', () => {
  it('asks for a link for the typed address and confirms', async () => {
    const { component, authApi } = setup();
    component.model.set({ email: 'anna@example.com' });

    await component.onSubmit(new Event('submit'));

    expect(authApi.forgotPassword).toHaveBeenCalledWith('anna@example.com');
    expect(component.submitted()).toBe(true);
  });

  it('confirms the same way when the request fails, so no answer tells accounts apart', async () => {
    const { component } = setup(async () => {
      throw new Error('429');
    });
    component.model.set({ email: 'anna@example.com' });

    await component.onSubmit();

    expect(component.submitted()).toBe(true);
  });

  it('sends nothing for a malformed address', async () => {
    const { component, authApi } = setup();
    component.model.set({ email: 'anna' });

    await component.onSubmit();

    expect(authApi.forgotPassword).not.toHaveBeenCalled();
    expect(component.submitted()).toBe(false);
    expect(component.forgotForm.email().errors()[0]?.message).toBe('AUTH.EMAIL_INVALID');
  });
});
