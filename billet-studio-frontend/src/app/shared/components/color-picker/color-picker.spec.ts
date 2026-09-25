import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { ColorPicker } from './color-picker';

@Component({
  imports: [ColorPicker],
  template: `<app-color-picker [(value)]="color" />`,
})
class Host {
  readonly color = signal('#c8614a');
}

describe('ColorPicker hex field', () => {
  let fixture: ComponentFixture<Host>;

  /** Opens the popover (a CDK overlay, outside the host in jsdom) and returns its hex field. */
  async function openHexField(): Promise<HTMLInputElement> {
    TestBed.configureTestingModule({ imports: [Host, translateTestingModule()] });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector('button')!.click();
    await fixture.whenStable();
    return document.querySelector<HTMLInputElement>('.color-picker__panel input[type="text"]')!;
  }

  async function type(field: HTMLInputElement, text: string, commit: boolean): Promise<void> {
    field.value = text;
    field.dispatchEvent(new Event('input'));
    if (commit) field.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  const color = () => fixture.componentInstance.color();
  const message = () => document.querySelector('.color-picker__panel .ui-field-error');

  afterEach(() => fixture.destroy());

  it('writes nothing for text that is no colour and shows why on commit', async () => {
    const field = await openHexField();

    for (const text of ['#c8614', 'rot', '#12345g', '']) {
      await type(field, text, true);
      expect(color(), text).toBe('#c8614a');
      expect(message(), text).not.toBeNull();
    }
  });

  it('writes a complete #rrggbb while typing, normalised to lowercase', async () => {
    const field = await openHexField();

    await type(field, '12AB9F', false);

    expect(color()).toBe('#12ab9f');
    expect(message()).toBeNull();
  });

  it('writes a short #rgb only on commit, expanded', async () => {
    const field = await openHexField();

    await type(field, '#3A7', false);
    expect(color()).toBe('#c8614a');

    await type(field, '#3A7', true);
    expect(color()).toBe('#33aa77');
    expect(field.value).toBe('#33aa77');
  });
});
