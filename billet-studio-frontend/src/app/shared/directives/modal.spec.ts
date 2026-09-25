import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '../../../test-helpers';
import { Modal } from './modal';

@Component({
  imports: [Modal],
  template: `
    <button id="opener" type="button">open</button>
    @if (present()) {
      <dialog
        [appModal]="open()"
        (dismissed)="dismissed.set(dismissed() + 1)"
        (closed)="closed.set(closed() + 1)"
      >
        <button id="inside" type="button">inside</button>
      </dialog>
    }
  `,
})
class Host {
  readonly present = signal(true);
  readonly open = signal(false);
  readonly dismissed = signal(0);
  readonly closed = signal(0);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('Modal', () => {
  let restore: () => void;
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const dialog = () => (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
  const byId = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${id}`)!;

  async function setOpen(open: boolean): Promise<void> {
    host.open.set(open);
    await fixture.whenStable();
  }

  function pointer(type: string, target: Element, at: { x: number; y: number }): void {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y }));
  }

  beforeEach(async () => {
    restore = installDialogPolyfill();
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    restore();
  });

  it('opens as a modal when the state turns true and closes when it turns false', async () => {
    await setOpen(true);
    expect(dialog().open).toBe(true);

    await setOpen(false);
    expect(dialog().open).toBe(false);
  });

  it('gives focus back to whatever opened it', async () => {
    byId('opener').focus();
    await setOpen(true);
    expect(document.activeElement).toBe(byId('inside'));

    await setOpen(false);
    expect(document.activeElement).toBe(byId('opener'));
  });

  it('Esc only asks: the owner decides, the dialog stays open meanwhile', async () => {
    await setOpen(true);
    const esc = new Event('cancel', { cancelable: true });

    dialog().dispatchEvent(esc);

    expect(esc.defaultPrevented).toBe(true);
    expect(host.dismissed()).toBe(1);
    expect(dialog().open).toBe(true);
  });

  it('a close the browser forces while still meant to be open is reported as a dismissal', async () => {
    await setOpen(true);

    dialog().close();

    expect(host.dismissed()).toBe(1);
  });

  it('a close that the state asked for is not a dismissal', async () => {
    await setOpen(true);
    await setOpen(false);

    expect(host.dismissed()).toBe(0);
  });

  it('a click on the backdrop asks to close; a click inside does not', async () => {
    await setOpen(true);
    const outside = { x: -10, y: -10 };

    pointer('pointerdown', byId('inside'), { x: 0, y: 0 });
    pointer('click', byId('inside'), { x: 0, y: 0 });
    expect(host.dismissed()).toBe(0);

    pointer('pointerdown', dialog(), outside);
    pointer('click', dialog(), outside);
    expect(host.dismissed()).toBe(1);
  });

  it('a text selection dragged out of the dialog is not a backdrop click', async () => {
    await setOpen(true);

    pointer('pointerdown', byId('inside'), { x: 0, y: 0 });
    pointer('click', dialog(), { x: -10, y: -10 });

    expect(host.dismissed()).toBe(0);
  });

  it('reports closed once off screen, after the closing transition', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    await setOpen(true);
    Object.assign(dialog(), { getAnimations: () => [{ finished }] });

    await setOpen(false);
    await flush();
    expect(host.closed()).toBe(0);

    finish();
    await flush();
    expect(host.closed()).toBe(1);
  });

  it('does not report closed when it was reopened during the transition', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    await setOpen(true);
    Object.assign(dialog(), { getAnimations: () => [{ finished }] });

    await setOpen(false);
    await setOpen(true);
    finish();
    await flush();

    expect(host.closed()).toBe(0);
  });

  it('removing an open dialog closes it and gives focus back', async () => {
    byId('opener').focus();
    await setOpen(true);
    const element = dialog();

    host.present.set(false);
    await fixture.whenStable();

    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(byId('opener'));
  });
});
