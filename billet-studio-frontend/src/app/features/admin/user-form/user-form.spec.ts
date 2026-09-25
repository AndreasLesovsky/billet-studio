import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { UserRequestDto, UserResponseDto } from '../../../core/models/models';
import { AdminUserApi } from '../../../core/services/admin-user-api';
import { AuthApi } from '../../../core/services/auth-api';
import { Language, LanguageService } from '../../../core/services/language-service';
import { BreadcrumbService } from '../../../shared/components/breadcrumb/breadcrumb-service';
import {
  createMockActivatedRoute,
  createMockAuthApi,
  createMockRouter,
  testUser,
  translateTestingModule,
} from '../../../../test-helpers';
import { UserForm } from './user-form';

const ME = 1;

const BERTA: UserResponseDto = {
  id: 20,
  name: 'Berta Blum',
  email: 'berta@example.com',
  role: 'ROLE_USER',
  preferredLanguage: 'de',
  avatarUrl: null,
  active: true,
  protectedAccount: false,
  deactivatedAt: null,
  deletionScheduledAt: null,
  deactivationReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(opts: { id?: string; get?: () => Promise<UserResponseDto> } = {}) {
  const adminUserApi = {
    roles: signal<string[]>([]),
    loadRoles: vi.fn(async () => {
      adminUserApi.roles.set(['ROLE_USER', 'ROLE_ADMIN']);
      return adminUserApi.roles();
    }),
    get: vi.fn(opts.get ?? (async () => BERTA)),
    create: vi.fn(async (dto: UserRequestDto) => ({ ...BERTA, ...dto, id: 21 })),
    update: vi.fn(async (id: number, dto: UserRequestDto) => ({ ...BERTA, ...dto, id })),
  };
  const authApi = createMockAuthApi({ user: testUser({ id: ME }) });
  const breadcrumb = { setDynamicLabel: vi.fn() };
  const router = createMockRouter();
  const params: Record<string, string> = opts.id ? { id: opts.id } : {};
  const paramMap = new BehaviorSubject<ParamMap>(convertToParamMap(params));

  TestBed.configureTestingModule({
    imports: [UserForm, translateTestingModule()],
    providers: [
      { provide: AdminUserApi, useValue: adminUserApi },
      { provide: AuthApi, useValue: authApi },
      { provide: BreadcrumbService, useValue: breadcrumb },
      {
        provide: LanguageService,
        useValue: { currentLang: signal<Language>('en'), availableLanguages: ['de', 'en'] },
      },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: { ...createMockActivatedRoute({}, params), paramMap },
      },
    ],
  });
  // Loads async and renders children: the logic is under test, not the template.
  TestBed.overrideComponent(UserForm, { set: { template: '<div></div>', imports: [] } });
  const component = TestBed.createComponent(UserForm).componentInstance;
  return { component, adminUserApi, authApi, breadcrumb, router, paramMap };
}

describe('UserForm', () => {
  it('creates an account: empty, in the UI language, and ready once the roles are there', async () => {
    const { component, adminUserApi } = setup();
    expect(component.ready()).toBe(false);
    await flush();

    expect(component.isEditMode).toBe(false);
    expect(component.ready()).toBe(true);
    expect(adminUserApi.get).not.toHaveBeenCalled();
    expect(component.model()).toMatchObject({
      name: '',
      role: 'ROLE_USER',
      preferredLanguage: 'en',
    });
    expect(component.canUndo()).toBe(false);
  });

  it('a new account needs a password', async () => {
    const { component } = setup();
    await flush();
    component.model.update((m) => ({ ...m, name: 'Carl', email: 'carl@example.com' }));

    expect(component.userForm.password().errors()[0]?.message).toBe(
      'ADMIN_USERS.PASSWORD_REQUIRED',
    );

    component.model.update((m) => ({ ...m, password: 'Secret123' }));
    expect(component.userForm().valid()).toBe(true);
  });

  it('saves a new account, then returns to the list without asking', async () => {
    const { component, adminUserApi, router } = setup();
    await flush();
    component.model.update((m) => ({
      ...m,
      name: 'Carl',
      email: 'carl@example.com',
      password: 'Secret123',
    }));

    await component.onSubmit(new Event('submit'));

    expect(adminUserApi.create).toHaveBeenCalledWith({
      name: 'Carl',
      email: 'carl@example.com',
      password: 'Secret123',
      role: 'ROLE_USER',
      preferredLanguage: 'en',
      active: true,
      deactivationReason: null,
    });
    expect(component.canUndo()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
  });

  it('an untouched or invalid form sends nothing and shows every problem', async () => {
    const { component, adminUserApi } = setup();
    await flush();

    await component.onSubmit();
    component.model.update((m) => ({ ...m, name: 'Carl' }));
    await component.onSubmit();

    expect(adminUserApi.create).not.toHaveBeenCalled();
    expect(component.userForm.email().touched()).toBe(true);
  });

  it('edits an account: loaded, named in the breadcrumb, nothing unsaved yet', async () => {
    const { component, adminUserApi, breadcrumb } = setup({ id: '20' });
    await flush();

    expect(component.isEditMode).toBe(true);
    expect(adminUserApi.get).toHaveBeenCalledWith(20);
    expect(component.model()).toMatchObject({ name: 'Berta Blum', password: '', active: true });
    expect(component.canUndo()).toBe(false);
    expect(breadcrumb.setDynamicLabel).toHaveBeenCalledWith('Berta Blum');
  });

  it('an empty password keeps the current one when editing', async () => {
    const { component, adminUserApi, router } = setup({ id: '20' });
    await flush();
    component.model.update((m) => ({ ...m, role: 'ROLE_ADMIN' }));

    expect(component.userForm().valid()).toBe(true);
    await component.onSubmit();

    expect(adminUserApi.update).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ password: '', role: 'ROLE_ADMIN' }),
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
  });

  it('locking an account sends the admin reason with it', async () => {
    const { component, adminUserApi } = setup({ id: '20' });
    await flush();
    component.model.update((m) => ({ ...m, active: false, deactivationReason: 'SPAM' }));

    await component.onSubmit();

    expect(adminUserApi.update).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ active: false, deactivationReason: 'SPAM' }),
    );
  });

  it('a plain edit of a self-deactivated account sends no reason, so its grace period stays', async () => {
    const { component, adminUserApi } = setup({
      id: '20',
      get: async () => ({
        ...BERTA,
        active: false,
        deactivatedAt: '2026-02-01T00:00:00Z',
        deletionScheduledAt: '2026-03-03T00:00:00Z',
        deactivationReason: 'PRIVACY_CONCERNS',
      }),
    });
    await flush();
    // The owner's reason is not an admin reason: the select reads "no reason".
    expect(component.model().deactivationReason).toBe('');
    component.model.update((m) => ({ ...m, name: 'Berta Bloom' }));

    await component.onSubmit();

    expect(adminUserApi.update).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ name: 'Berta Bloom', active: false, deactivationReason: null }),
    );
  });

  it('a refused save keeps the form and its changes', async () => {
    const { component, adminUserApi, router } = setup({ id: '20' });
    await flush();
    adminUserApi.update.mockRejectedValueOnce(new Error('409 EMAIL_ALREADY_EXISTS'));
    component.model.update((m) => ({ ...m, email: 'taken@example.com' }));

    await component.onSubmit();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.canUndo()).toBe(true);
  });

  it('undo brings back the loaded account', async () => {
    const { component } = setup({ id: '20' });
    await flush();
    component.model.update((m) => ({ ...m, name: 'Someone Else' }));

    component.undo();

    expect(component.model().name).toBe('Berta Blum');
  });

  it('editing your own account keeps it switched on and updates the header name', async () => {
    const { component, authApi } = setup({
      id: String(ME),
      get: async () => ({ ...BERTA, id: ME, name: 'Admin' }),
    });
    await flush();

    expect(component.editingSelf()).toBe(true);
    expect(component.userForm.active().disabled()).toBe(true);

    component.model.update((m) => ({ ...m, name: 'Admina' }));
    await component.onSubmit();

    expect(authApi.patchName).toHaveBeenCalledWith('Admina');
  });

  it("another account's switch stays free", async () => {
    const { component } = setup({ id: '20' });
    await flush();

    expect(component.editingSelf()).toBe(false);
    expect(component.userForm.active().disabled()).toBe(false);
  });

  it('loads the next account when the router keeps the page and only the id changes', async () => {
    const { component, adminUserApi, breadcrumb, paramMap } = setup({
      id: '20',
      get: async () => BERTA,
    });
    await flush();
    adminUserApi.get.mockImplementation(async () => ({ ...BERTA, id: 21, name: 'Carl Clay' }));

    paramMap.next(convertToParamMap({ id: '21' }));
    await flush();

    expect(adminUserApi.get).toHaveBeenLastCalledWith(21);
    expect(component.model().name).toBe('Carl Clay');
    expect(component.canUndo()).toBe(false);
    expect(breadcrumb.setDynamicLabel).toHaveBeenLastCalledWith('Carl Clay');

    component.model.update((m) => ({ ...m, role: 'ROLE_ADMIN' }));
    await component.onSubmit();
    expect(adminUserApi.update).toHaveBeenCalledWith(21, expect.anything());
  });

  it('an answer for an id the page has already left is dropped', async () => {
    let answerFirst: (user: UserResponseDto) => void = () => undefined;
    const { component, adminUserApi, router, paramMap } = setup({
      id: '20',
      get: () => new Promise<UserResponseDto>((resolve) => (answerFirst = resolve)),
    });
    adminUserApi.get.mockImplementationOnce(async () => ({ ...BERTA, id: 21, name: 'Carl Clay' }));

    paramMap.next(convertToParamMap({ id: '21' }));
    await flush();
    answerFirst({ ...BERTA, protectedAccount: true });
    await flush();

    expect(component.model().name).toBe('Carl Clay');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('never opens the root account, not even by URL', async () => {
    const { component, router } = setup({
      id: '2',
      get: async () => ({ ...BERTA, id: 2, protectedAccount: true }),
    });
    await flush();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
    expect(component.ready()).toBe(false);
  });

  it('returns to the list when the account cannot be loaded', async () => {
    const { component, router } = setup({
      id: '404',
      get: async () => {
        throw new Error('USER_NOT_FOUND');
      },
    });
    await flush();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
    expect(component.ready()).toBe(false);
  });

  it('asks for no account behind an id that is not one', async () => {
    const { adminUserApi, router } = setup({ id: 'abc' });
    await flush();

    expect(adminUserApi.get).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/users');
  });
});
