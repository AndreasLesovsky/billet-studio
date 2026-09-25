import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { describe, expect, it } from 'vitest';

import { BilletText } from './billet-text';

const LIMIT = 10;

@Component({
  imports: [BilletText, FormField],
  template: `<textarea appBilletText [formField]="textForm.text"></textarea>`,
})
class Host {
  readonly model = signal({ text: '' });
  readonly textForm = form(this.model, (p) => maxLength(p.text, LIMIT, { message: 'X.Y' }));
}

describe('BilletText', () => {
  function setUp() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    return { host: fixture.componentInstance, textarea };
  }

  it.each([
    ['a tab becomes a space', 'a\tb', 'a b'],
    ['a no-break space stays', 'a b', 'a b'],
    ['a paste over the limit is cut at the limit', '0123456789XYZ', '0123456789'],
  ])('%s', (_, typed, stored) => {
    const { host, textarea } = setUp();

    textarea.value = typed;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(textarea.value).toBe(stored);
    expect(host.model().text).toBe(stored);
  });

  it('leaves an IME composition alone until it ends', () => {
    const { host, textarea } = setUp();

    textarea.value = 'a\tb';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    expect(host.model().text).toBe('a\tb');

    textarea.dispatchEvent(new CompositionEvent('compositionend'));
    expect(host.model().text).toBe('a b');
  });
});
