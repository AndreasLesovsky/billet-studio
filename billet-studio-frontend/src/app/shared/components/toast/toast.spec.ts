import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageStore } from '../../../core/stores/message-store';
import { translateTestingModule } from '../../../../test-helpers';
import { AUTO_DISMISS_MS, Toast } from './toast';

describe('Toast', () => {
  let fixture: ComponentFixture<Toast>;
  let store: MessageStore;

  const root = () => fixture.nativeElement as HTMLElement;
  const toasts = () => [...root().querySelectorAll<HTMLElement>('.ui-toast')];
  const region = (live: string) => root().querySelector(`[aria-live="${live}"]`)!;
  const countdown = () => root().querySelector('.toast__countdown')?.textContent?.trim();

  function render(): void {
    fixture.detectChanges();
  }

  function advance(ms: number): void {
    vi.advanceTimersByTime(ms);
    render();
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-22T10:00:00Z') });
    TestBed.configureTestingModule({ imports: [Toast, translateTestingModule()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      MESSAGES: {
        SUCCESS: { SAVED: 'Gespeichert: {{title}}' },
        ERROR: { BROKEN: 'Kaputt.' },
        WARNING: { SESSION_ENDING: 'Deine Sitzung endet in' },
      },
    });
    translate.use('de');
    store = TestBed.inject(MessageStore);
    fixture = TestBed.createComponent(Toast);
    render();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  it('renders MESSAGES.<TYPE>.<code> with the message params', () => {
    store.addMessage('success', 'SAVED', undefined, { title: 'Muttertag' });
    render();

    expect(toasts()[0].textContent).toContain('Gespeichert: Muttertag');
    expect(toasts()[0].classList).toContain('ui-toast--success');
  });

  it('announces errors assertively and successes politely', () => {
    store.addMessage('error', 'BROKEN');
    store.addMessage('success', 'SAVED');
    render();

    expect(region('assertive').textContent).toContain('Kaputt.');
    expect(region('polite').textContent).toContain('Gespeichert');
    expect(toasts()[0].classList).toContain('ui-toast--danger');
  });

  it('an ordinary toast leaves by itself after AUTO_DISMISS_MS', () => {
    store.addMessage('success', 'SAVED');
    render();

    advance(AUTO_DISMISS_MS - 1);
    expect(toasts()).toHaveLength(1);

    advance(1);
    expect(store.messages()).toHaveLength(0);
    expect(toasts()).toHaveLength(0);
  });

  it('holds while the pointer rests on it and runs out the rest afterwards', () => {
    store.addMessage('success', 'SAVED');
    render();
    advance(1000);

    toasts()[0].dispatchEvent(new Event('pointerenter'));
    advance(AUTO_DISMISS_MS * 2);
    expect(store.messages()).toHaveLength(1);

    toasts()[0].dispatchEvent(new Event('pointerleave'));
    advance(AUTO_DISMISS_MS - 1001);
    expect(store.messages()).toHaveLength(1);
    advance(1);
    expect(store.messages()).toHaveLength(0);
  });

  it('holds while focus is inside, even after the pointer has left', () => {
    store.addMessage('success', 'SAVED');
    render();

    const toast = toasts()[0];
    toast.dispatchEvent(new Event('pointerenter'));
    toast.dispatchEvent(new FocusEvent('focusin'));
    toast.dispatchEvent(new Event('pointerleave'));
    advance(AUTO_DISMISS_MS * 2);

    expect(store.messages()).toHaveLength(1);
  });

  it('the close button removes it at once', () => {
    store.addMessage('error', 'BROKEN');
    render();

    toasts()[0].querySelector('button')!.click();
    render();

    expect(store.messages()).toHaveLength(0);
  });

  it('the session warning stays and counts its deadline down as m:ss', () => {
    store.showSessionWarning('SESSION_ENDING', Date.now() + 5 * 60_000);
    render();

    expect(toasts()[0].textContent).toContain('Deine Sitzung endet in');
    expect(countdown()).toBe('5:00');
    // The ticking clock is kept away from screen readers.
    expect(root().querySelector('.toast__countdown')!.getAttribute('aria-hidden')).toBe('true');

    advance(61_000);
    expect(countdown()).toBe('3:59');

    advance(10 * 60_000);
    expect(countdown()).toBe('0:00');
    expect(store.messages()).toHaveLength(1);
  });
});
