import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { installDialogPolyfill, translateTestingModule } from '../../../../test-helpers';
import { ConfirmationModal } from './confirmation-modal';

const QUESTION = {
  title: 'Benutzer löschen?',
  message: 'Das lässt sich nicht rückgängig machen.',
  confirmLabel: 'Löschen',
  cancelLabel: 'Abbrechen',
  confirmVariant: 'danger',
} as const;

describe('ConfirmationModal', () => {
  let restore: () => void;
  let fixture: ComponentFixture<ConfirmationModal>;
  let store: ConfirmationModalStore;

  const dialog = () => (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
  const buttons = () => [
    ...dialog().querySelectorAll<HTMLButtonElement>('.ui-dialog__footer button'),
  ];

  beforeEach(async () => {
    restore = installDialogPolyfill();
    TestBed.configureTestingModule({ imports: [ConfirmationModal, translateTestingModule()] });
    store = TestBed.inject(ConfirmationModalStore);
    fixture = TestBed.createComponent(ConfirmationModal);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    restore();
  });

  it('asks the question with cancel focused first and the confirm button in its variant', async () => {
    void store.askConfirmation(QUESTION);
    await fixture.whenStable();

    expect(dialog().open).toBe(true);
    expect(dialog().textContent).toContain(QUESTION.title);
    expect(dialog().textContent).toContain(QUESTION.message);
    const [cancel, confirm] = buttons();
    expect(document.activeElement).toBe(cancel);
    expect(confirm.classList).toContain('ui-btn--danger');
  });

  it('answers yes on confirm and no on Esc', async () => {
    const yes = store.askConfirmation(QUESTION);
    await fixture.whenStable();
    buttons()[1].click();
    await expect(yes).resolves.toBe(true);

    await fixture.whenStable();
    const no = store.askConfirmation(QUESTION);
    await fixture.whenStable();
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(no).resolves.toBe(false);
  });

  it('cannot be dismissed while the confirmed action runs', async () => {
    let finish!: () => void;
    store.open({ ...QUESTION, onConfirm: () => new Promise<void>((r) => (finish = r)) });
    await fixture.whenStable();

    buttons()[1].click();
    await fixture.whenStable();
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.whenStable();

    expect(store.isOpen()).toBe(true);
    expect(buttons().every((b) => b.disabled)).toBe(true);

    finish();
    await fixture.whenStable();
    expect(store.isOpen()).toBe(false);
  });

  it('lets its text go once it is off screen', async () => {
    void store.askConfirmation(QUESTION);
    await fixture.whenStable();

    buttons()[0].click();
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve));

    expect(dialog().open).toBe(false);
    expect(store.config()).toBeNull();
  });
});
