import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { ColorModeService, ColorModeSetting } from '../../../core/theme/color-mode-service';
import { ColorModeMenu } from './color-mode-menu';

describe('ColorModeMenu', () => {
  let fixture: ComponentFixture<ColorModeMenu>;
  const mode = signal<ColorModeSetting>('dark');
  const setMode = vi.fn();

  const trigger = () => (fixture.nativeElement as HTMLElement).querySelector('button')!;
  /** The menu renders into the CDK overlay container, outside the component. */
  const items = () => [
    ...document.querySelectorAll<HTMLElement>('.ui-menu [role="menuitemradio"]'),
  ];

  async function open(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ColorModeMenu, translateTestingModule()],
      providers: [{ provide: ColorModeService, useValue: { mode, setMode } }],
    });
    fixture = TestBed.createComponent(ColorModeMenu);
    await fixture.whenStable();
    trigger().click();
    await fixture.whenStable();
  }

  afterEach(() => {
    fixture.destroy();
    setMode.mockReset();
  });

  it('offers system, light and dark as radio items with the current setting checked', async () => {
    await open();

    expect(items().map((i) => [i.textContent?.trim(), i.getAttribute('aria-checked')])).toEqual([
      ['COLOR_MODE.SYSTEM', 'false'],
      ['COLOR_MODE.LIGHT', 'false'],
      ['COLOR_MODE.DARK', 'true'],
    ]);
    expect(trigger().querySelector('.bi')?.classList).toContain('bi-moon-stars');
  });

  it('choosing an item sets the colour mode', async () => {
    await open();

    items()[0].click();

    expect(setMode).toHaveBeenCalledWith('system');
  });
});
