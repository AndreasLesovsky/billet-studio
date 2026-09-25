import { Component, computed, input } from '@angular/core';

import type { DividerStyle } from '../billet-document';

/**
 * A decorative rule: two hairlines around a mark in the accent colour. `diamond` is the live
 * Mother's Day card, `dot` the Valentine's card; `line` is one unbroken hairline, `none` draws nothing.
 */
@Component({
  selector: 'app-billet-divider',
  host: { 'aria-hidden': 'true' },
  template: `
    @if (variant() !== 'none') {
      <span class="line"></span>
      @if (mark()) {
        <span class="mark" [attr.data-mark]="variant()"></span>
        <span class="line"></span>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }

    .line {
      flex: 1;
      block-size: 0.03125rem;
      background: var(--billet-border);
    }

    .mark {
      flex: none;
      background: var(--billet-accent);
      opacity: 0.6;
    }

    [data-mark='diamond'] {
      inline-size: 0.375rem;
      block-size: 0.375rem;
      opacity: 0.5;
      transform: rotate(45deg);
    }

    [data-mark='dot'] {
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-radius: 50%;
    }

    [data-mark='star'] {
      inline-size: 0.75rem;
      block-size: 0.75rem;
      clip-path: polygon(
        50% 0%,
        61% 35%,
        98% 35%,
        68% 57%,
        79% 91%,
        50% 70%,
        21% 91%,
        32% 57%,
        2% 35%,
        39% 35%
      );
    }

    // A square turned 45° with two round lobes: the lobes end up top left and top right.
    [data-mark='heart'] {
      position: relative;
      inline-size: 0.4375rem;
      block-size: 0.4375rem;
      margin-block-start: 0.1875rem;
      transform: rotate(45deg);

      &::before,
      &::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: inherit;
      }

      &::before {
        translate: -50% 0;
      }

      &::after {
        translate: 0 -50%;
      }
    }
  `,
})
export class BilletDivider {
  readonly variant = input.required<DividerStyle>();

  protected readonly mark = computed(() => this.variant() !== 'line');
}
