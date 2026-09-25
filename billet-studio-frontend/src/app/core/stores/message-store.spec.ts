import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { MessageStore } from './message-store';

const FIVE_MINUTES = 5 * 60 * 1000;

describe('MessageStore', () => {
  let store: MessageStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MessageStore] });
    store = TestBed.inject(MessageStore);
  });

  afterEach(() => vi.useRealTimers());

  describe('addMessage', () => {
    it('queues a toast with its code, status and params', () => {
      store.addMessage('error', 'BILLET_LIMIT_REACHED', 409, { max: 50 });

      expect(store.messages()).toEqual([
        expect.objectContaining({
          type: 'error',
          code: 'BILLET_LIMIT_REACHED',
          status: 409,
          params: { max: 50 },
        }),
      ]);
    });

    it('drops the same code reported twice within a second - one event, two requests', () => {
      vi.useFakeTimers();
      store.addMessage('error', 'INTERNAL_SERVER_ERROR', 500);
      store.addMessage('error', 'INTERNAL_SERVER_ERROR', 500);
      expect(store.messages()).toHaveLength(1);

      vi.advanceTimersByTime(1001);
      store.addMessage('error', 'INTERNAL_SERVER_ERROR', 500);
      expect(store.messages()).toHaveLength(2);
    });

    it('keeps at most four, dropping the oldest', () => {
      ['A', 'B', 'C', 'D', 'E'].forEach((code) => store.addMessage('info', code));

      expect(store.messages().map((m) => m.code)).toEqual(['B', 'C', 'D', 'E']);
    });

    it('removeMessage takes one toast off by id', () => {
      store.addMessage('success', 'A');
      store.addMessage('success', 'B');

      store.removeMessage(store.messages()[0].id);

      expect(store.messages().map((m) => m.code)).toEqual(['B']);
    });
  });

  describe('the session warning', () => {
    it('keeps the standing toast when the same deadline is shown again', () => {
      // Every tab switch replans the session and lands here. Dismiss + re-push would hand the toast
      // a new id, and the rebuilt element restarts its slide-in and its progress bar at full.
      const endsAt = Date.now() + FIVE_MINUTES;
      store.showSessionWarning('SESSION_ENDING', endsAt);
      const shown = store.messages()[0];

      store.showSessionWarning('SESSION_ENDING', endsAt);

      expect(store.messages()).toHaveLength(1);
      expect(store.messages()[0].id).toBe(shown.id);
      expect(store.messages()[0].countdownFrom).toBe(shown.countdownFrom);
    });

    it('replaces the toast when the deadline has moved', () => {
      const endsAt = Date.now() + FIVE_MINUTES;
      store.showSessionWarning('SESSION_ENDING', endsAt);
      const shown = store.messages()[0];

      store.showSessionWarning('SESSION_ENDING', endsAt + 30 * 60 * 1000);

      expect(store.messages()).toHaveLength(1);
      expect(store.messages()[0].id).not.toBe(shown.id);
    });

    it('comes back after the user has closed it', () => {
      // The deadline is read off the list, not remembered in a field: a closed warning leaves no
      // trace, so the next plan shows it again.
      const endsAt = Date.now() + FIVE_MINUTES;
      store.showSessionWarning('SESSION_ENDING', endsAt);
      store.removeMessage(store.messages()[0].id);

      store.showSessionWarning('SESSION_ENDING', endsAt);

      expect(store.messages()).toHaveLength(1);
    });

    it('reports the deadline it is showing, and nothing once dismissed', () => {
      const endsAt = Date.now() + FIVE_MINUTES;
      expect(store.sessionWarningEndsAt()).toBeNull();

      store.showSessionWarning('SESSION_ENDING', endsAt);
      expect(store.sessionWarningEndsAt()).toBe(endsAt);

      store.dismissSessionWarning();
      expect(store.sessionWarningEndsAt()).toBeNull();
    });

    it('is not confused by ordinary toasts around it', () => {
      const endsAt = Date.now() + FIVE_MINUTES;
      store.addMessage('success', 'ACCOUNT_UPDATED');
      store.showSessionWarning('SESSION_ENDING', endsAt);
      store.addMessage('info', 'SESSION_ENDED_BY_OTHER_TAB');

      expect(store.sessionWarningEndsAt()).toBe(endsAt);
      expect(store.messages()).toHaveLength(3);
    });

    it('outlasts a burst of other toasts', () => {
      const endsAt = Date.now() + FIVE_MINUTES;
      store.showSessionWarning('SESSION_ENDING', endsAt);
      ['A', 'B', 'C', 'D', 'E'].forEach((code) => store.addMessage('info', code));

      expect(store.sessionWarningEndsAt()).toBe(endsAt);
      expect(store.messages()).toHaveLength(4);
    });
  });
});
