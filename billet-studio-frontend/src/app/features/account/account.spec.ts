import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { AccountDto, AccountUpdateDto } from '../../core/models/models';
import { AccountApi } from '../../core/services/account-api';
import { Language, LanguageService } from '../../core/services/language-service';
import { translateTestingModule } from '../../../test-helpers';
import { Account } from './account';

const ACCOUNT: AccountDto = {
  id: 7,
  name: 'Anna',
  email: 'anna@example.com',
  role: 'ROLE_USER',
  preferredLanguage: 'de',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const CHANGE = {
  currentPassword: 'Old-one1',
  newPassword: 'Secret123',
  confirmPassword: 'Secret123',
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const accountApi = {
    account: signal<AccountDto | null>(null),
    get: vi.fn(async () => ACCOUNT),
    update: vi.fn(async (dto: AccountUpdateDto) => ({ ...ACCOUNT, ...dto })),
    changePassword: vi.fn(async () => undefined),
  };
  const languageService = {
    currentLang: signal<Language>('de'),
    locale: signal('de-DE'),
    availableLanguages: ['de', 'en'] as const,
    setLanguage: vi.fn(),
  };

  TestBed.configureTestingModule({
    imports: [Account, translateTestingModule()],
    providers: [
      { provide: AccountApi, useValue: accountApi },
      { provide: LanguageService, useValue: languageService },
    ],
  });
  // Loads async and renders children (avatar, dialog): the logic is under test, not the template.
  TestBed.overrideComponent(Account, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(Account);
  return { component: fixture.componentInstance, accountApi, languageService };
}

describe('Account', () => {
  it('after loading, nothing is unsaved and saving the profile sends nothing', async () => {
    const { component, accountApi } = setup();
    await flush();

    expect(component.profileModel()).toEqual({ name: 'Anna', preferredLanguage: 'de' });
    expect(component.canUndo()).toBe(false);
    await component.onProfileSubmit();
    expect(accountApi.update).not.toHaveBeenCalled();
  });

  it('saves a changed profile and takes the saved one as the new baseline', async () => {
    const { component, accountApi, languageService } = setup();
    await flush();
    component.profileModel.update((m) => ({ ...m, name: 'Anna Maria' }));
    expect(component.canUndo()).toBe(true);

    await component.onProfileSubmit(new Event('submit'));

    expect(accountApi.update).toHaveBeenCalledWith({ name: 'Anna Maria', preferredLanguage: 'de' });
    expect(component.canUndo()).toBe(false);
    expect(languageService.setLanguage).not.toHaveBeenCalled();
  });

  it('a saved language change switches the interface too', async () => {
    const { component, languageService } = setup();
    await flush();
    component.profileModel.update((m) => ({ ...m, preferredLanguage: 'en' }));

    await component.onProfileSubmit();

    expect(languageService.setLanguage).toHaveBeenCalledWith('en');
  });

  it('undo brings back the loaded profile', async () => {
    const { component } = setup();
    await flush();
    component.profileModel.set({ name: 'Someone', preferredLanguage: 'en' });

    component.undoProfile();

    expect(component.profileModel()).toEqual({ name: 'Anna', preferredLanguage: 'de' });
    expect(component.canUndo()).toBe(false);
  });

  it('a typed password is unsaved work for the leave guard', async () => {
    const { component } = setup();
    await flush();

    component.passwordModel.update((m) => ({ ...m, currentPassword: 'x' }));

    expect(component.canUndo()).toBe(true);
  });

  it('changes the password and empties the form', async () => {
    const { component, accountApi } = setup();
    await flush();
    component.passwordModel.set(CHANGE);

    await component.onPasswordSubmit(new Event('submit'));

    expect(accountApi.changePassword).toHaveBeenCalledWith(CHANGE);
    expect(component.passwordModel()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    expect(component.passwordForm.newPassword().touched()).toBe(false);
    expect(component.canUndo()).toBe(false);
  });

  it('keeps what was typed when the current password is refused', async () => {
    const { component, accountApi } = setup();
    await flush();
    accountApi.changePassword.mockRejectedValueOnce(new Error('INVALID_PASSWORD'));
    component.passwordModel.set(CHANGE);

    await component.onPasswordSubmit();

    expect(component.passwordModel()).toEqual(CHANGE);
  });

  it.each([
    [{ ...CHANGE, confirmPassword: 'Secret124' }],
    [{ ...CHANGE, newPassword: 'secret123', confirmPassword: 'secret123' }],
    [{ ...CHANGE, currentPassword: '' }],
  ])('sends no password change that breaks a rule: %j', async (change) => {
    const { component, accountApi } = setup();
    await flush();
    component.passwordModel.set(change);

    await component.onPasswordSubmit();

    expect(accountApi.changePassword).not.toHaveBeenCalled();
    expect(component.passwordForm().invalid()).toBe(true);
  });
});
