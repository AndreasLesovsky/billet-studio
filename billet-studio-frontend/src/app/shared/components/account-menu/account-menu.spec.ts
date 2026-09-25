import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthApi } from '../../../core/services/auth-api';
import {
  createMockAuthApi,
  MockAuthApi,
  testUser,
  translateTestingModule,
} from '../../../../test-helpers';
import { AccountMenu } from './account-menu';

describe('AccountMenu', () => {
  let fixture: ComponentFixture<AccountMenu>;
  let authApi: MockAuthApi;

  /** The menu renders into the CDK overlay container, outside the component. */
  const items = () => [...document.querySelectorAll<HTMLElement>('.ui-menu .ui-menu__item')];
  const links = () => items().map((item) => item.getAttribute('href'));

  async function openAs(user: ReturnType<typeof testUser> | null): Promise<void> {
    authApi = createMockAuthApi({ user });
    TestBed.configureTestingModule({
      imports: [AccountMenu, translateTestingModule()],
      providers: [provideRouter([]), { provide: AuthApi, useValue: authApi }],
    });
    fixture = TestBed.createComponent(AccountMenu);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    await fixture.whenStable();
  }

  afterEach(() => fixture.destroy());

  it('offers a guest sign in and sign up, without a returnUrl', async () => {
    await openAs(null);

    expect(links()).toEqual(['/login', '/register']);
  });

  it('offers a signed-in user the account and sign out, but no user management', async () => {
    await openAs(testUser({ email: 'anna@example.com' }));

    expect(links()).toEqual(['/account', null]);
    expect(items()[0].textContent).toContain('anna@example.com');
  });

  it('offers an admin the user management as well', async () => {
    await openAs(testUser({ role: 'ROLE_ADMIN' }));

    expect(links()).toEqual(['/account', '/admin/users', null]);
  });

  it('signs out through AuthApi', async () => {
    await openAs(testUser());

    items().at(-1)!.click();

    expect(authApi.logout).toHaveBeenCalledOnce();
  });
});
