import { Directive, signal } from '@angular/core';

/**
 * The anchor of a CSS tooltip: `<span appTooltipAnchor>` around a control and its
 * `.ui-tooltip[role=tooltip]`, which the control names in aria-describedby (or aria-labelledby).
 * The tooltip shows while the anchor is hovered or holds the focus (_surfaces.scss). Esc anywhere
 * hides it until the next hover or focus (WCAG 1.4.13: dismissible without moving the pointer or
 * the focus, which may be elsewhere while the pointer rests on the anchor).
 */
@Directive({
  selector: '[appTooltipAnchor]',
  host: {
    class: 'ui-tooltip-anchor',
    '[class.ui-tooltip-anchor--dismissed]': 'dismissed()',
    '(document:keydown.escape)': 'dismissed.set(true)',
    '(pointerenter)': 'dismissed.set(false)',
    '(focusin)': 'dismissed.set(false)',
  },
})
export class TooltipAnchor {
  protected readonly dismissed = signal(false);
}
