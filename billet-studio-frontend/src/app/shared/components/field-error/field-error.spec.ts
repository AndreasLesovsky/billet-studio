import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { FieldError } from './field-error';

@Component({
  imports: [FormField, FieldError],
  template: `
    <input id="name" aria-describedby="name-hint" [formField]="probeForm.name" />
    <p id="name-hint">hint</p>
    <app-field-error [field]="probeForm.name" />
  `,
})
class Host {
  readonly model = signal({ name: '' });
  readonly probeForm = form(this.model, (p) => {
    required(p.name, { message: 'FORMS.REQUIRED' });
    maxLength(p.name, 3, { message: 'FORMS.MAX_LENGTH' });
  });
}

describe('FieldError', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const root = () => fixture.nativeElement as HTMLElement;
  const input = () => root().querySelector('input')!;
  const message = () => root().querySelector('.ui-field-error');

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host, translateTestingModule()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      FORMS: { REQUIRED: 'Pflichtfeld.', MAX_LENGTH: 'Höchstens {{maxLength}} Zeichen.' },
    });
    translate.use('de');
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  async function touch(): Promise<void> {
    host.probeForm.name().markAsTouched();
    await fixture.whenStable();
  }

  async function type(value: string): Promise<void> {
    host.model.update((m) => ({ ...m, name: value }));
    await fixture.whenStable();
  }

  it('says nothing about an invalid field the user has not touched yet', () => {
    expect(message()).toBeNull();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows the message of the first rule that broke, as an alert', async () => {
    await touch();

    expect(message()?.textContent?.trim()).toBe('Pflichtfeld.');
    expect(message()?.getAttribute('role')).toBe('alert');
  });

  it("fills the text's placeholders from the rule's own error", async () => {
    await type('abcd');
    await touch();

    expect(message()?.textContent?.trim()).toBe('Höchstens 3 Zeichen.');
  });

  it('ties the message to its control while it shows, keeping the control’s own hint', async () => {
    await touch();
    const id = message()!.id;

    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe(`name-hint ${id}`);

    await type('ok');

    expect(message()).toBeNull();
    expect(input().hasAttribute('aria-invalid')).toBe(false);
    expect(input().getAttribute('aria-describedby')).toBe('name-hint');
  });
});
