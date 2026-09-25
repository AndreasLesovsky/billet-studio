import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SessionClock } from './session-clock';
import { AuthApi } from './auth-api';
import { AccessToken } from './access-token';
import { MessageStore } from '../stores/message-store';

const MINUTE = 60 * 1000;

describe('SessionClock', () => {
  let endsAt: ReturnType<typeof signal<number | null>>;
  let auth: {
    isLoggedIn: ReturnType<typeof signal<boolean>>;
    renewInUse: ReturnType<typeof vi.fn>;
  };
  let messageStore: {
    showSessionWarning: ReturnType<typeof vi.fn>;
    dismissSessionWarning: ReturnType<typeof vi.fn>;
    sessionWarningEndsAt: ReturnType<typeof vi.fn>;
  };
  /** What the mocked store is currently showing, so the clock can ask it the way it does live. */
  let standingWarning: number | null;

  /** Creates the clock with a session that has `minutes` left. */
  function start(minutes: number | null): void {
    endsAt.set(minutes === null ? null : Date.now() + minutes * MINUTE);
    TestBed.inject(SessionClock);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    endsAt = signal<number | null>(null);
    auth = {
      isLoggedIn: signal(true),
      renewInUse: vi.fn(async () => 'renewed'),
    };
    standingWarning = null;
    messageStore = {
      showSessionWarning: vi.fn((_code: string, at: number) => {
        standingWarning = at;
      }),
      dismissSessionWarning: vi.fn(() => {
        standingWarning = null;
      }),
      sessionWarningEndsAt: vi.fn(() => standingWarning),
    };

    TestBed.configureTestingModule({
      providers: [
        SessionClock,
        { provide: AuthApi, useValue: auth },
        { provide: AccessToken, useValue: { endsAt } },
        { provide: MessageStore, useValue: messageStore },
      ],
    });
  });

  afterEach(() => {
    // Destroys the clock, which removes its visibilitychange listener and clears its timers.
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('the warning', () => {
    it('appears five minutes before the end, not before', () => {
      start(30);

      vi.advanceTimersByTime(24 * MINUTE);
      expect(messageStore.showSessionWarning).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2 * MINUTE);
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();
    });

    it('stays away for a deadline that has already passed, and checks instead', async () => {
      start(-1);

      await vi.advanceTimersByTimeAsync(3000);

      expect(messageStore.showSessionWarning).not.toHaveBeenCalled();
      expect(auth.renewInUse).toHaveBeenCalledOnce();
    });

    it('takes half of a window too short for a five-minute lead', () => {
      start(4);
      expect(messageStore.showSessionWarning).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2 * MINUTE + 1000);
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();
    });

    it('shows the full rest immediately when the tab wakes up late', () => {
      // Browsers throttle timers in background tabs, so the warning planned for minute 25 never
      // fires. Waking at minute 28 must warn now, with the two minutes that are left - not half.
      start(30);
      const deadline = endsAt()!;
      vi.setSystemTime(Date.now() + 28 * MINUTE);

      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(0);

      expect(messageStore.showSessionWarning).toHaveBeenCalledWith('SESSION_ENDING', deadline);
    });

    it('leaves a warning that is still about this deadline alone', () => {
      // Dismissing and re-showing it would give the toast a new id, restarting its progress bar at
      // full while the mm:ss - computed from the deadline - carries on correctly.
      start(30);
      vi.advanceTimersByTime(26 * MINUTE);
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();
      messageStore.dismissSessionWarning.mockClear();

      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(0);

      expect(messageStore.dismissSessionWarning).not.toHaveBeenCalled();
    });

    it('keeps the five-minute lead when the tab wakes with more than that left', () => {
      start(30);
      vi.setSystemTime(Date.now() + 10 * MINUTE);

      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(0);
      expect(messageStore.showSessionWarning).not.toHaveBeenCalled();

      vi.advanceTimersByTime(15 * MINUTE + 1000);
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();
    });

    it('goes away when the deadline moves, whoever moved it', () => {
      start(30);
      vi.advanceTimersByTime(26 * MINUTE);
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();

      // A renewal here or in another tab - both arrive as a new deadline.
      endsAt.set(Date.now() + 30 * MINUTE);
      TestBed.tick();

      expect(messageStore.dismissSessionWarning).toHaveBeenCalled();
      expect(messageStore.showSessionWarning).toHaveBeenCalledOnce();
    });
  });

  // What a refused renewal MEANS is AuthApi's, and is pinned in auth-api.spec.ts. The clock's own
  // behaviour is when it asks, and that it survives whatever comes back.
  describe('the check after the deadline', () => {
    it('asks the server rather than trusting the local clock', async () => {
      start(30);

      vi.advanceTimersByTime(30 * MINUTE + 2000);
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.renewInUse).toHaveBeenCalledOnce();
    });

    it('waits out the deadline before asking, so an absent user is not renewed', async () => {
      start(30);

      vi.advanceTimersByTime(30 * MINUTE - 1000);
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.renewInUse).not.toHaveBeenCalled();
    });

    it('does not ask for a session that is already gone', async () => {
      auth.isLoggedIn.set(false);
      start(30);

      vi.advanceTimersByTime(30 * MINUTE + 2000);
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.renewInUse).not.toHaveBeenCalled();
    });

    it('a renewal that throws does not take the clock with it', async () => {
      // endSession runs component code through UnsavedWork.keepAll, so this can reject. An
      // unhandled rejection here fails the whole run, not just this spec.
      auth.renewInUse.mockRejectedValue(new Error('keepAll blew up'));
      start(30);

      vi.advanceTimersByTime(30 * MINUTE + 2000);
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.renewInUse).toHaveBeenCalledOnce();
    });
  });

  it('plans nothing without a session', () => {
    start(null);
    vi.advanceTimersByTime(60 * MINUTE);

    expect(messageStore.showSessionWarning).not.toHaveBeenCalled();
    expect(auth.renewInUse).not.toHaveBeenCalled();
  });
});
