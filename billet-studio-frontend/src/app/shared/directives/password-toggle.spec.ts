import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../test-helpers';
import { PasswordToggle } from './password-toggle';

@Component({
  imports: [PasswordToggle],
  template: `
    <form (submit)="$event.preventDefault()">
      <div class="ui-field">
        <label for="pw">Password</label>
        @if (present()) {
          <input id="pw" class="ui-input" type="password" />
        }
        <p id="after">hint</p>
      </div>
    </form>
  `,
})
class Host {
  readonly present = signal(true);
}

describe('PasswordToggle', () => {
  let fixture: ComponentFixture<Host>;
  let root: HTMLElement;

  const input = () => root.querySelector<HTMLInputElement>('#pw')!;
  const toggle = () => root.querySelector<HTMLButtonElement>('.ui-password-toggle');

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host, translateTestingModule()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', { COMMON: { SHOW_PASSWORD: 'Passwort anzeigen' } });
    translate.use('de');
    fixture = TestBed.createComponent(Host);
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('puts a labelled toggle button right after the input, even inside an @if block', () => {
    const button = toggle()!;

    expect(input().nextElementSibling).toBe(button);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Passwort anzeigen');
    expect(button.getAttribute('aria-controls')).toBe('pw');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows and hides the password, reporting the state as pressed', async () => {
    toggle()!.click();
    await fixture.whenStable();
    expect(input().type).toBe('text');
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    expect(toggle()!.querySelector('i')!.className).toContain('bi-eye-slash');

    toggle()!.click();
    await fixture.whenStable();
    expect(input().type).toBe('password');
    expect(toggle()!.getAttribute('aria-pressed')).toBe('false');
  });

  it('hides the password again when the form is submitted', async () => {
    toggle()!.click();
    await fixture.whenStable();

    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(input().type).toBe('password');
  });

  it('takes its button along when the input goes', async () => {
    fixture.componentInstance.present.set(false);
    await fixture.whenStable();

    expect(toggle()).toBeNull();
  });
});
