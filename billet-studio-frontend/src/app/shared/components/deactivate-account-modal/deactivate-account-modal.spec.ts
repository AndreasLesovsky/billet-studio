import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AccountApi } from '../../../core/services/account-api';
import { translateTestingModule } from '../../../../test-helpers';
import { DeactivateAccountModal } from './deactivate-account-modal';
import { EMPTY_MODEL, toDeactivateDto } from './deactivate-account-modal-schema';

function setup(deactivate: () => Promise<void> = async () => undefined) {
  const accountApi = { deactivate: vi.fn(deactivate) };

  TestBed.configureTestingModule({
    imports: [DeactivateAccountModal, translateTestingModule()],
    providers: [{ provide: AccountApi, useValue: accountApi }],
  });
  TestBed.overrideComponent(DeactivateAccountModal, {
    set: { template: '<div></div>', imports: [] },
  });
  const fixture = TestBed.createComponent(DeactivateAccountModal);
  const component = fixture.componentInstance;
  component.open.set(true);
  return { component, accountApi };
}

describe('DeactivateAccountModal', () => {
  it('deactivates with the password and the chosen reason, then closes', async () => {
    const { component, accountApi } = setup();
    component.model.set({ password: 'Secret123', reason: 'PRIVACY_CONCERNS' });

    await component.onSubmit(new Event('submit'));

    expect(accountApi.deactivate).toHaveBeenCalledWith({
      password: 'Secret123',
      reason: 'PRIVACY_CONCERNS',
    });
    expect(component.open()).toBe(false);
  });

  it('sends no reason when none was chosen', async () => {
    const { component, accountApi } = setup();
    component.model.set({ password: 'Secret123', reason: '' });

    await component.onSubmit();

    expect(accountApi.deactivate).toHaveBeenCalledWith({ password: 'Secret123', reason: null });
  });

  it('sends nothing without the password and says so', async () => {
    const { component, accountApi } = setup();

    await component.onSubmit();

    expect(accountApi.deactivate).not.toHaveBeenCalled();
    expect(component.deactivateForm.password().touched()).toBe(true);
    expect(component.deactivateForm.password().errors()[0]?.message).toBe(
      'AUTH.CURRENT_PASSWORD_REQUIRED',
    );
  });

  it('shows a refused password inside the dialog, which stays open', async () => {
    const { component } = setup(async () => {
      throw new HttpErrorResponse({ status: 400, error: { errorCode: 'INVALID_PASSWORD' } });
    });
    component.model.set({ password: 'wrong', reason: '' });

    await component.onSubmit();

    expect(component.failure()).toBe('INVALID_PASSWORD');
    expect(component.open()).toBe(true);
  });

  it('names a failure without an errorCode as unknown', async () => {
    const { component } = setup(async () => {
      throw new HttpErrorResponse({ status: 0 });
    });
    component.model.set({ password: 'Secret123', reason: '' });

    await component.onSubmit();

    expect(component.failure()).toBe('UNKNOWN_ERROR');
  });

  it('cannot be cancelled while the request runs', () => {
    const { component } = setup(() => new Promise<void>(() => undefined));
    component.model.set({ password: 'Secret123', reason: '' });
    void component.onSubmit();

    component.cancel();

    expect(component.deactivating()).toBe(true);
    expect(component.open()).toBe(true);
  });

  it('starts empty on the next opening once it has closed', async () => {
    const { component } = setup(async () => {
      throw new HttpErrorResponse({ status: 400, error: { errorCode: 'INVALID_PASSWORD' } });
    });
    component.model.set({ password: 'wrong', reason: 'OTHER' });
    await component.onSubmit();
    component.cancel();

    component.onClosed();

    expect(component.open()).toBe(false);
    expect(component.model()).toEqual(EMPTY_MODEL);
    expect(component.deactivateForm.password().touched()).toBe(false);
    expect(component.failure()).toBeNull();
  });

  it('never sends an admin reason from the user side', () => {
    expect(toDeactivateDto({ password: 'p', reason: 'FRAUD' })).toEqual({
      password: 'p',
      reason: null,
    });
  });
});
