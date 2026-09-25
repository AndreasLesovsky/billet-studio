import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { THEME_IDS, ThemeId } from '../../../core/theme/theme-registry.generated';
import { ColorModeSetting, ThemeService } from '../../../core/theme/theme-service';
import { ThemePicker } from './theme-picker';

function setup(
  options: { theme?: ThemeId; mode?: ColorModeSetting; resolved?: 'light' | 'dark' } = {},
) {
  const service = {
    theme: signal<ThemeId>(options.theme ?? 'rose'),
    mode: signal<ColorModeSetting>(options.mode ?? 'system'),
    resolvedMode: signal<'light' | 'dark'>(options.resolved ?? 'light'),
    setTheme: vi.fn(),
    setMode: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [ThemePicker, translateTestingModule()],
    providers: [{ provide: ThemeService, useValue: service }],
  });
  const fixture = TestBed.createComponent(ThemePicker);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, service };
}

const themeRadios = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLInputElement>('.ui-theme-option input[type="radio"]'),
];
const modeRadios = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLInputElement>('.ui-segmented input[type="radio"]'),
];

describe('ThemePicker', () => {
  it('offers every registry theme as one radio group with the current theme checked', () => {
    const { host } = setup({ theme: 'midnight' });
    const radios = themeRadios(host);

    expect(radios.map((r) => r.value)).toEqual([...THEME_IDS]);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['midnight']);
  });

  it('previews each card in its own theme and in the resolved mode', () => {
    const { host, fixture, service } = setup({ resolved: 'dark' });
    const cards = [...host.querySelectorAll<HTMLElement>('.ui-theme-card')];

    expect(cards.map((c) => c.dataset['theme'])).toEqual([...THEME_IDS]);
    expect(cards.every((c) => c.dataset['mode'] === 'dark')).toBe(true);

    service.resolvedMode.set('light');
    fixture.detectChanges();
    expect(cards.every((c) => c.dataset['mode'] === 'light')).toBe(true);
  });

  it('selecting a card switches the theme', () => {
    const { host, service } = setup();
    const sage = themeRadios(host).find((r) => r.value === 'sage');
    sage?.click();

    expect(service.setTheme).toHaveBeenCalledWith('sage');
  });

  it('the mode control reflects and sets system / light / dark', () => {
    const { host, service } = setup({ mode: 'dark' });
    const radios = modeRadios(host);

    expect(radios.map((r) => r.value)).toEqual(['system', 'light', 'dark']);
    expect(radios.find((r) => r.checked)?.value).toBe('dark');

    radios[0].click();
    expect(service.setMode).toHaveBeenCalledWith('system');
  });

  it('keeps radio groups apart when two pickers are on one page', () => {
    const first = setup().host;
    const second = TestBed.createComponent(ThemePicker);
    second.detectChanges();
    const host2 = second.nativeElement as HTMLElement;

    expect(themeRadios(first)[0].name).not.toBe(themeRadios(host2)[0].name);
    expect(modeRadios(first)[0].name).not.toBe(modeRadios(host2)[0].name);
  });
});
