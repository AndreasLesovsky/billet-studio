import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { disabled, form, FormField } from '@angular/forms/signals';
import { describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { THEME_IDS } from '../../../core/theme/theme-registry.generated';
import { ThemePicker } from './theme-picker';

@Component({
  imports: [ThemePicker],
  template: `<app-theme-picker [(value)]="theme" />`,
})
class StandaloneHost {
  readonly theme = signal('midnight');
}

@Component({
  imports: [ThemePicker, FormField],
  template: `<app-theme-picker [formField]="designForm.theme" />`,
})
class FormHost {
  readonly locked = signal(false);
  readonly model = signal({ theme: 'midnight' });
  readonly designForm = form(this.model, (p) => {
    disabled(p.theme, { when: () => this.locked() });
  });
}

function render<T>(host: new () => T) {
  TestBed.configureTestingModule({
    imports: [host, translateTestingModule()],
    providers: [{ provide: ColorModeService, useValue: { resolvedMode: signal('light') } }],
  });
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const radios = () => [
    ...element.querySelectorAll<HTMLInputElement>('.ui-theme-option input[type="radio"]'),
  ];
  const checked = () =>
    radios()
      .filter((r) => r.checked)
      .map((r) => r.value);
  const pick = (id: string) =>
    radios()
      .find((r) => r.value === id)!
      .click();
  return { fixture, element, radios, checked, pick };
}

describe('ThemePicker', () => {
  it('offers every editor theme, each card scoped to its own theme', () => {
    const { element, radios } = render(StandaloneHost);
    const cards = [...element.querySelectorAll<HTMLElement>('.ui-theme-card')];

    expect(radios().map((r) => r.value)).toEqual([...THEME_IDS]);
    expect(cards.map((c) => c.dataset['theme'])).toEqual([...THEME_IDS]);
    expect(new Set(cards.map((c) => c.dataset['mode']))).toEqual(new Set(['light']));
  });

  it('works standalone with [(value)] in both directions', () => {
    const { fixture, checked, pick } = render(StandaloneHost);
    expect(checked()).toEqual(['midnight']);

    pick('sage');
    expect(fixture.componentInstance.theme()).toBe('sage');

    fixture.componentInstance.theme.set('neon');
    fixture.detectChanges();
    expect(checked()).toEqual(['neon']);
  });

  it('works as a [formField] control, value and disabled state included', () => {
    const { fixture, radios, checked, pick } = render(FormHost);
    expect(checked()).toEqual(['midnight']);

    pick('paper');
    expect(fixture.componentInstance.model().theme).toBe('paper');

    fixture.componentInstance.locked.set(true);
    fixture.detectChanges();
    expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
  });

  it('shows the default theme for an unknown value without writing it back', () => {
    const { fixture, checked } = render(StandaloneHost);
    fixture.componentInstance.theme.set('studio');
    fixture.detectChanges();

    expect(checked()).toEqual(['rose']);
    expect(fixture.componentInstance.theme()).toBe('studio');
  });

  it('keeps radio groups apart when two pickers are on one page', () => {
    const first = render(StandaloneHost).radios()[0].name;
    const second = TestBed.createComponent(StandaloneHost);
    second.detectChanges();
    const other = (second.nativeElement as HTMLElement).querySelector('input')!.name;

    expect(first).not.toBe(other);
  });
});
