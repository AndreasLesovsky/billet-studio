import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { UserResponseDto } from '../../../../core/models/models';
import { AdminUserApi } from '../../../../core/services/admin-user-api';
import { translateTestingModule } from '../../../../../test-helpers';
import { LockUserDialog } from './lock-user-dialog';

const BERTA = { id: 20, name: 'Berta', active: true } as UserResponseDto;

function setup(toggle: () => Promise<unknown> = async () => ({ ...BERTA, active: false })) {
  const adminUserApi = { toggleActive: vi.fn(toggle) };

  TestBed.configureTestingModule({
    imports: [LockUserDialog, translateTestingModule()],
    providers: [{ provide: AdminUserApi, useValue: adminUserApi }],
  });
  TestBed.overrideComponent(LockUserDialog, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(LockUserDialog);
  const component = fixture.componentInstance;
  const locked = vi.fn();
  component.locked.subscribe(locked);
  component.user.set(BERTA);
  return { component, adminUserApi, locked };
}

describe('LockUserDialog', () => {
  it('locks with the chosen reason, closes and reports it', async () => {
    const { component, adminUserApi, locked } = setup();
    component.model.set({ reason: 'SPAM' });

    await component.onSubmit(new Event('submit'));

    expect(adminUserApi.toggleActive).toHaveBeenCalledWith(20, 'SPAM');
    expect(component.user()).toBeNull();
    expect(locked).toHaveBeenCalledTimes(1);
  });

  it('locks without a reason when none was chosen', async () => {
    const { component, adminUserApi } = setup();

    await component.onSubmit();

    expect(adminUserApi.toggleActive).toHaveBeenCalledWith(20, null);
  });

  it('stays open for another try when the lock is refused', async () => {
    const { component, locked } = setup(async () => {
      throw new Error('ROOT_USER_PROTECTED');
    });

    await component.onSubmit();

    expect(component.user()).toBe(BERTA);
    expect(locked).not.toHaveBeenCalled();
  });

  it('cannot be cancelled while the request runs', () => {
    const { component } = setup(() => new Promise(() => undefined));
    void component.onSubmit();

    component.cancel();

    expect(component.locking()).toBe(true);
    expect(component.user()).toBe(BERTA);
  });

  it('a cancel closes it, and once closed it starts empty the next time', () => {
    const { component } = setup();
    component.model.set({ reason: 'FRAUD' });

    component.cancel();
    component.onClosed();

    expect(component.user()).toBeNull();
    expect(component.model()).toEqual({ reason: '' });
  });
});
