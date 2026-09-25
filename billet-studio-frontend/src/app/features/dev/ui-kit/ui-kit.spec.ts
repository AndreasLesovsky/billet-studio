import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { UiKit } from './ui-kit';

describe('UiKit', () => {
  let host: HTMLElement;
  let detect: () => void;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiKit, translateTestingModule()] });
    const fixture = TestBed.createComponent(UiKit);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
  });

  const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  const visiblePanels = () =>
    [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((p) => !p.hidden);

  function press(key: string, tab: HTMLElement): void {
    tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    detect();
  }

  it('arrow keys move selection and focus through the tabs and wrap around', () => {
    const [content, , scene] = tabs();
    content.focus();

    press('ArrowLeft', content);
    expect(scene.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(scene);
    expect(visiblePanels().map((p) => p.id)).toEqual(['kit-panel-scene']);

    press('ArrowRight', scene);
    expect(content.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps exactly one tab in the tab order', () => {
    press('End', tabs()[0]);

    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('the range fill follows the value', () => {
    const range = host.querySelector<HTMLInputElement>('#kit-spacing');
    if (!range) throw new Error('range missing');
    range.value = '75';
    range.dispatchEvent(new Event('input'));
    detect();

    expect(range.style.getPropertyValue('--ui-range-progress')).toBe('75%');
  });
});
