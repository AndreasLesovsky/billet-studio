import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ConfirmationModalStore } from './confirmation-modal-store';

describe('ConfirmationModalStore', () => {
  let store: ConfirmationModalStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ConfirmationModalStore] });
    store = TestBed.inject(ConfirmationModalStore);
  });

  const ask = () =>
    store.askConfirmation({
      title: 't',
      message: 'm',
      confirmLabel: 'ok',
      cancelLabel: 'no',
      confirmVariant: 'danger',
    });

  describe('askConfirmation', () => {
    it('resolves true on confirm, despite the close() that follows it', async () => {
      // confirm() runs the callback and then closes, so both paths reach settle. Resolving twice
      // would overwrite every confirmed answer with the false from the way out.
      const answer = ask();
      await store.confirm();

      await expect(answer).resolves.toBe(true);
      expect(store.isOpen()).toBe(false);
    });

    it('resolves false on cancel', async () => {
      const answer = ask();
      store.close();

      await expect(answer).resolves.toBe(false);
    });

    it('resolves false when the dialog goes away without close() (Esc on a native dialog)', async () => {
      const answer = ask();
      store.onHidden();

      await expect(answer).resolves.toBe(false);
      expect(store.config()).toBeNull();
    });

    it('a second question answers the first with no instead of leaving it hanging forever', async () => {
      const first = ask();
      const second = ask();

      await expect(first).resolves.toBe(false);
      await store.confirm();
      await expect(second).resolves.toBe(true);
    });
  });

  describe('open with a callback', () => {
    it('runs the callback and closes on success', async () => {
      const onConfirm = vi.fn(async () => undefined);
      store.open({
        title: 't',
        message: 'm',
        confirmLabel: 'ok',
        cancelLabel: 'no',
        confirmVariant: 'primary',
        onConfirm,
      });

      await store.confirm();

      expect(onConfirm).toHaveBeenCalledOnce();
      expect(store.isOpen()).toBe(false);
      expect(store.isExecuting()).toBe(false);
    });

    it("stays open for another try when the callback fails (the toast is the interceptor's)", async () => {
      store.open({
        title: 't',
        message: 'm',
        confirmLabel: 'ok',
        cancelLabel: 'no',
        confirmVariant: 'danger',
        onConfirm: () => Promise.reject(new Error('409')),
      });

      await store.confirm();

      expect(store.isOpen()).toBe(true);
      expect(store.isExecuting()).toBe(false);
    });

    it('confirm without an open dialog does nothing', async () => {
      await store.confirm();

      expect(store.isExecuting()).toBe(false);
    });
  });
});
