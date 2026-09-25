import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { keepUnsavedWork } from './keep-unsaved-work';
import { UnsavedWork } from '../services/unsaved-work';
import { ConfirmationModalStore } from '../stores/confirmation-modal-store';

describe('keepUnsavedWork', () => {
  let unsavedWork: {
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    reclaim: ReturnType<typeof vi.fn>;
  };
  let store: { askConfirmation: ReturnType<typeof vi.fn> };
  const source = { isDirty: () => true, capture: () => ({ name: 'half typed' }) };

  beforeEach(() => {
    unsavedWork = { register: vi.fn(), unregister: vi.fn(), reclaim: vi.fn(() => null) };
    store = { askConfirmation: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: UnsavedWork, useValue: unsavedWork },
        { provide: ConfirmationModalStore, useValue: store },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
  });

  it('registers for the lifetime of its injector and unregisters when that is destroyed', () => {
    const child = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(child, () => keepUnsavedWork('account', source));

    expect(unsavedWork.register).toHaveBeenCalledWith('account', source);
    expect(unsavedWork.unregister).not.toHaveBeenCalled();

    child.destroy();
    expect(unsavedWork.unregister).toHaveBeenCalledWith('account');
  });

  it('asks nothing when nothing was kept', async () => {
    const control = TestBed.runInInjectionContext(() => keepUnsavedWork('account', source));
    const apply = vi.fn();

    await control.offerKept(apply);

    expect(store.askConfirmation).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('offers kept work back and applies it on yes', async () => {
    unsavedWork.reclaim.mockReturnValue({ name: 'half typed' });
    const control = TestBed.runInInjectionContext(() => keepUnsavedWork('account', source));
    const apply = vi.fn();

    await control.offerKept(apply);

    expect(store.askConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'FORMS.KEPT_WORK_TITLE', confirmVariant: 'primary' }),
    );
    expect(apply).toHaveBeenCalledWith({ name: 'half typed' });
  });

  it('drops it on no', async () => {
    unsavedWork.reclaim.mockReturnValue({ name: 'half typed' });
    store.askConfirmation.mockResolvedValue(false);
    const control = TestBed.runInInjectionContext(() => keepUnsavedWork('account', source));
    const apply = vi.fn();

    await control.offerKept(apply);

    expect(apply).not.toHaveBeenCalled();
  });
});
