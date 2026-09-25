import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { UnsavedWork } from './unsaved-work';

describe('UnsavedWork', () => {
  let unsavedWork: UnsavedWork;

  const OWNER = 7;
  const OTHER_USER = 8;

  function register(routeKey: string, dirty: boolean, bundle: unknown): void {
    unsavedWork.register(routeKey, { isDirty: () => dirty, capture: () => bundle });
  }

  // One instance for the whole file: the beforeunload listener is attached in the constructor and
  // lives as long as the window, so a fresh instance per test would leave the old ones listening.
  beforeAll(() => {
    TestBed.configureTestingModule({ providers: [UnsavedWork] });
    unsavedWork = TestBed.inject(UnsavedWork);
  });

  beforeEach(() => {
    ['account', 'admin/users/8'].forEach((key) => unsavedWork.unregister(key));
    unsavedWork.reclaim('account');
    unsavedWork.reclaim('admin/users/8');
    unsavedWork.setOwner(OWNER);
  });

  it('keeps a dirty form and hands it back', () => {
    register('account', true, { name: 'half typed' });
    unsavedWork.keepAll();

    expect(unsavedWork.reclaim('account')).toEqual({ name: 'half typed' });
  });

  it('keeps nothing from a clean form', () => {
    register('account', false, { name: 'saved' });
    unsavedWork.keepAll();

    expect(unsavedWork.reclaim('account')).toBeNull();
  });

  it('hands back once, so the question does not return on the next visit', () => {
    register('account', true, { name: 'half typed' });
    unsavedWork.keepAll();

    unsavedWork.reclaim('account');

    expect(unsavedWork.reclaim('account')).toBeNull();
  });

  it('offers nothing for a different record', () => {
    register('account', true, { name: 'half typed' });
    unsavedWork.keepAll();

    expect(unsavedWork.reclaim('admin/users/8')).toBeNull();
  });

  it('offers nothing to a different person', () => {
    // Two people on one machine. Checked here rather than in each component, where the next
    // component to be written would be the one that forgets.
    register('account', true, { name: 'half typed' });
    unsavedWork.keepAll();

    unsavedWork.setOwner(OTHER_USER);

    expect(unsavedWork.reclaim('account')).toBeNull();
  });

  it('keeps nothing while nobody owns the work', () => {
    unsavedWork.setOwner(undefined);
    register('account', true, { name: 'half typed' });
    unsavedWork.keepAll();
    unsavedWork.setOwner(OWNER);

    expect(unsavedWork.reclaim('account')).toBeNull();
  });

  it('drops a form that unregistered before the session ended', () => {
    register('account', true, { name: 'half typed' });
    unsavedWork.unregister('account');
    unsavedWork.keepAll();

    expect(unsavedWork.reclaim('account')).toBeNull();
  });

  describe('beforeunload', () => {
    function unloadPrevented(): boolean {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('warns while a registered form is dirty', () => {
      register('account', true, {});

      expect(unloadPrevented()).toBe(true);
    });

    it('stays out of the way otherwise', () => {
      register('account', false, {});

      expect(unloadPrevented()).toBe(false);
    });
  });
});
