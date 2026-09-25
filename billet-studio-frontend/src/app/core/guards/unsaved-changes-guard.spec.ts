import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, type CanDeactivateFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { unsavedChangesGuard, HasUnsavedChanges } from './unsaved-changes-guard';
import { AuthApi } from '../services/auth-api';
import { ConfirmationModalStore } from '../stores/confirmation-modal-store';
import { createMockAuthApi } from '../../../test-helpers';

describe('unsavedChangesGuard', () => {
  let store: { askConfirmation: ReturnType<typeof vi.fn> };

  function configure(loggedIn: boolean): void {
    TestBed.resetTestingModule();
    store = { askConfirmation: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApi, useValue: createMockAuthApi({ loggedIn }) },
        { provide: ConfirmationModalStore, useValue: store },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
  }

  function run(dirty: boolean): Promise<boolean> {
    const component: HasUnsavedChanges = { canUndo: signal(dirty) };
    const guard = unsavedChangesGuard as CanDeactivateFn<HasUnsavedChanges>;
    return TestBed.runInInjectionContext(() =>
      Promise.resolve(
        guard(
          component,
          {} as ActivatedRouteSnapshot,
          {} as RouterStateSnapshot,
          {} as RouterStateSnapshot,
        ),
      ),
    ) as Promise<boolean>;
  }

  beforeEach(() => configure(true));

  it('lets a clean form go without asking', async () => {
    await expect(run(false)).resolves.toBe(true);
    expect(store.askConfirmation).not.toHaveBeenCalled();
  });

  it('asks when the form is dirty, as a danger action, and leaves on confirm', async () => {
    await expect(run(true)).resolves.toBe(true);
    expect(store.askConfirmation).toHaveBeenCalledWith({
      title: 'FORMS.UNSAVED_TITLE',
      message: 'FORMS.UNSAVED_MESSAGE',
      confirmLabel: 'FORMS.UNSAVED_DISCARD',
      cancelLabel: 'FORMS.UNSAVED_STAY',
      confirmVariant: 'danger',
    });
  });

  it('stays put when the answer is no', async () => {
    store.askConfirmation.mockResolvedValue(false);

    await expect(run(true)).resolves.toBe(false);
  });

  it('never blocks a session that has ended', async () => {
    // The guard would otherwise hold someone on a protected route after they were thrown out.
    // Their work is not lost by leaving: UnsavedWork keeps it across the logout.
    configure(false);

    await expect(run(true)).resolves.toBe(true);
    expect(store.askConfirmation).not.toHaveBeenCalled();
  });
});
