import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageDto, UserResponseDto } from '../../../core/models/models';
import { AdminUserApi, UserListQuery } from '../../../core/services/admin-user-api';
import { AuthApi } from '../../../core/services/auth-api';
import { LanguageService } from '../../../core/services/language-service';
import {
  ConfirmationModalConfig,
  ConfirmationModalStore,
} from '../../../core/stores/confirmation-modal-store';
import {
  createMockActivatedRoute,
  createMockAuthApi,
  createMockRouter,
  testUser,
  translateTestingModule,
} from '../../../../test-helpers';
import { UserList } from './user-list';

function user(overrides: Partial<UserResponseDto> = {}): UserResponseDto {
  return {
    id: 20,
    name: 'Berta',
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
    ...overrides,
  };
}

const ME = 1;

function setup(
  page: (query: UserListQuery) => PageDto<UserResponseDto> = (q) => ({
    rows: [user()],
    totalRows: 1,
    page: q.page,
    size: q.size,
  }),
) {
  const adminUserApi = {
    list: vi.fn(async (query: UserListQuery) => page(query)),
    toggleActive: vi.fn(async () => user()),
    delete: vi.fn(async () => undefined),
  };
  const confirmation = { open: vi.fn<(config: ConfirmationModalConfig) => void>() };
  const router = createMockRouter();
  const route = createMockActivatedRoute();

  TestBed.configureTestingModule({
    imports: [UserList, translateTestingModule()],
    providers: [
      { provide: AdminUserApi, useValue: adminUserApi },
      { provide: AuthApi, useValue: createMockAuthApi({ user: testUser({ id: ME }) }) },
      { provide: ConfirmationModalStore, useValue: confirmation },
      { provide: LanguageService, useValue: { locale: signal('de-DE') } },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: route },
    ],
  });
  // Loads through a resource and renders a child dialog: the logic is under test, not the template.
  TestBed.overrideComponent(UserList, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(UserList);
  const params = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) fixture.componentRef.setInput(name, value);
  };
  return {
    fixture,
    component: fixture.componentInstance,
    adminUserApi,
    confirmation,
    router,
    route,
    params,
  };
}

/** The query params of the last navigation. */
function lastNavigation(router: ReturnType<typeof createMockRouter>) {
  const [commands, extras] = router.navigate.mock.lastCall ?? [];
  return {
    commands,
    extras: extras as { queryParams: Record<string, unknown>; replaceUrl: boolean },
  };
}

describe('UserList', () => {
  afterEach(() => vi.useRealTimers());

  it('loads the page the URL names', async () => {
    const { fixture, component, adminUserApi, params } = setup();
    params({ page: '2', q: 'ber', active: 'true', sort: 'name', dir: 'asc' });
    await fixture.whenStable();

    expect(adminUserApi.list).toHaveBeenLastCalledWith({
      page: 1,
      size: 20,
      q: 'ber',
      active: true,
      sort: 'name',
      direction: 'asc',
    });
    expect(component.shown()?.rows).toHaveLength(1);
    expect(component.model()).toEqual({ q: 'ber', active: 'true' });
  });

  it('sorting by a column writes the new sort to the URL, from the first page', async () => {
    const { fixture, component, router, route, params } = setup();
    params({ page: '3' });
    await fixture.whenStable();

    component.sortBy('name');

    const { commands, extras } = lastNavigation(router);
    expect(commands).toEqual([]);
    expect(extras).toMatchObject({ relativeTo: route, replaceUrl: false });
    expect(extras.queryParams).toEqual({
      page: null,
      q: null,
      active: null,
      sort: 'name',
      dir: 'asc',
    });
    expect(component.ariaSort('createdAt')).toBe('descending');
    expect(component.sortIcon('createdAt')).toBe('bi-sort-down');
    expect(component.ariaSort('name')).toBe('none');
    expect(component.sortIcon('name')).toBe('bi-arrow-down-up');
  });

  it('paging keeps the filter and the sort', async () => {
    const { fixture, component, router, params } = setup();
    params({ q: 'ber', sort: 'email', dir: 'desc' });
    await fixture.whenStable();

    component.goToPage(1);

    expect(lastNavigation(router).extras.queryParams).toEqual({
      page: 2,
      q: 'ber',
      active: null,
      sort: 'email',
      dir: 'desc',
    });
  });

  it('the pager knows where it is and where its ends are', async () => {
    const { fixture, component, router, params } = setup((q) => ({
      rows: [user()],
      totalRows: 45,
      page: q.page,
      size: q.size,
    }));
    params({ page: '3' });
    await fixture.whenStable();

    expect(component.pageNumber()).toBe(3);
    expect(component.pageCount()).toBe(3);
    expect(component.hasPrevious()).toBe(true);
    expect(component.hasNext()).toBe(false);

    component.previousPage();
    expect(lastNavigation(router).extras.queryParams).toMatchObject({ page: 2 });
  });

  it('searches once typing pauses, replacing the history entry', async () => {
    const { fixture, component, router } = setup();
    await fixture.whenStable();
    vi.useFakeTimers();

    component.model.update((m) => ({ ...m, q: 'an' }));
    component.onSearchInput();
    vi.advanceTimersByTime(200);
    component.model.update((m) => ({ ...m, q: 'anna' }));
    component.onSearchInput();
    vi.advanceTimersByTime(299);
    expect(router.navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(lastNavigation(router).extras).toMatchObject({
      replaceUrl: true,
      queryParams: { q: 'anna', page: null },
    });
  });

  it('applies the status filter at once, from the first page', async () => {
    const { fixture, component, router, params } = setup();
    params({ page: '4' });
    await fixture.whenStable();
    vi.useFakeTimers();

    component.model.update((m) => ({ ...m, active: 'false' }));
    component.onStatusChange();
    vi.advanceTimersByTime(0);

    expect(lastNavigation(router).extras.queryParams).toMatchObject({
      page: null,
      active: 'false',
    });
  });

  it('typing back to what the URL already says navigates nowhere', async () => {
    const { fixture, component, router, params } = setup();
    params({ q: 'anna' });
    await fixture.whenStable();
    vi.useFakeTimers();

    component.model.update((m) => ({ ...m, q: 'anna ' }));
    component.onSearchInput();
    vi.advanceTimersByTime(300);

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('keeps what is typed while only the page changes', async () => {
    const { fixture, component, params } = setup();
    await fixture.whenStable();

    component.model.update((m) => ({ ...m, q: 'ann' }));
    params({ page: '2' });

    expect(component.model().q).toBe('ann');
  });

  it("keeps typing that went on after the bar's own navigation came back", async () => {
    const { fixture, component, params } = setup();
    await fixture.whenStable();
    vi.useFakeTimers();

    component.model.update((m) => ({ ...m, q: 'ann' }));
    component.onSearchInput();
    vi.advanceTimersByTime(300);
    component.model.update((m) => ({ ...m, q: 'anna' }));
    params({ q: 'ann' });

    expect(component.model().q).toBe('anna');
  });

  it('takes the filter from the URL when it changes from outside (back button, a link)', async () => {
    const { fixture, component, params } = setup();
    params({ q: 'anna' });
    await fixture.whenStable();

    params({ q: 'berta', active: 'false' });

    expect(component.model()).toEqual({ q: 'berta', active: 'false' });
  });

  it('a page past the end moves to the last page there is', async () => {
    const { fixture, router, params } = setup((q) => ({
      rows: [],
      totalRows: 41,
      page: q.page,
      size: q.size,
    }));
    params({ page: '9' });
    await fixture.whenStable();

    expect(lastNavigation(router).extras).toMatchObject({
      replaceUrl: true,
      queryParams: { page: 3 },
    });
  });

  it('locking an active account opens the lock dialog for it', () => {
    const { component, confirmation } = setup();
    const target = user();

    component.toggleActive(target);

    expect(component.lockTarget()).toBe(target);
    expect(confirmation.open).not.toHaveBeenCalled();
  });

  it('unlocking asks first, then unlocks without a reason and reloads', async () => {
    const { fixture, component, confirmation, adminUserApi } = setup();
    await fixture.whenStable();
    adminUserApi.list.mockClear();

    component.toggleActive(user({ active: false }));
    const config = confirmation.open.mock.lastCall![0];
    expect(config.confirmVariant).toBe('primary');
    await config.onConfirm();
    await fixture.whenStable();

    expect(adminUserApi.toggleActive).toHaveBeenCalledWith(20, null);
    expect(adminUserApi.list).toHaveBeenCalled();
  });

  it('deleting asks with a danger button, then deletes and reloads', async () => {
    const { fixture, component, confirmation, adminUserApi } = setup();
    await fixture.whenStable();
    adminUserApi.list.mockClear();

    component.confirmDelete(user());
    const config = confirmation.open.mock.lastCall![0];
    expect(config.confirmVariant).toBe('danger');
    await config.onConfirm();
    await fixture.whenStable();

    expect(adminUserApi.delete).toHaveBeenCalledWith(20);
    expect(adminUserApi.list).toHaveBeenCalled();
  });

  it('the root account and your own stay out of reach, and say why', () => {
    const { component, confirmation } = setup();
    const root = user({ id: 2, protectedAccount: true });
    const self = user({ id: ME });

    for (const row of [root, self]) {
      expect(component.canLockOrDelete(row)).toBe(false);
      component.toggleActive(row);
      component.confirmDelete(row);
    }

    expect(component.lockTarget()).toBeNull();
    expect(confirmation.open).not.toHaveBeenCalled();
    expect(component.canEdit(root)).toBe(false);
    expect(component.editLink(root)).toBeNull();
    expect(component.canEdit(self)).toBe(true);
    expect(component.editLink(self)).toEqual(['/admin/users', ME]);
    expect(component.editHint(root)).toBe('user-list-protected-hint');
    expect(component.lockOrDeleteHint(root)).toBe('user-list-protected-hint');
    expect(component.lockOrDeleteHint(self)).toBe('user-list-self-hint');
    expect(component.lockOrDeleteHint(user())).toBeNull();
  });

  it('offers a retry when the first page fails to load', async () => {
    const { fixture, component, adminUserApi } = setup(() => {
      throw new Error('500');
    });
    await fixture.whenStable();

    expect(component.failed()).toBe(true);

    adminUserApi.list.mockImplementation(async (q) => ({
      rows: [user()],
      totalRows: 1,
      page: q.page,
      size: q.size,
    }));
    component.retry();
    await fixture.whenStable();

    expect(component.failed()).toBe(false);
    expect(component.shown()?.totalRows).toBe(1);
  });
});
