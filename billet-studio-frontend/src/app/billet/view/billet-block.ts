import { Component, input } from '@angular/core';

import type { BilletBlock as BilletBlockData } from '../billet-document';
import { BilletDivider } from './billet-divider';
import { RichText } from './rich-text';

/** One block of the billet body, drawn by its type. BilletView places, spaces and reveals it. */
@Component({
  selector: 'app-billet-block',
  imports: [BilletDivider, RichText],
  template: `
    @switch (block().type) {
      @case ('paragraph') {
        <app-billet-rich-text class="paragraph" [text]="block().text" />
      }
      @case ('heading') {
        <h2 class="heading">
          <app-billet-rich-text [text]="block().text" [inline]="true" />
        </h2>
      }
      @case ('card') {
        <div class="card" role="note" [attr.aria-label]="block().ariaLabel || null">
          @if (block().icon) {
            <span class="card-icon" aria-hidden="true">
              {{ block().icon }}
            </span>
          }
          <app-billet-rich-text class="card-text" variant="card" [text]="block().text" />
        </div>
      }
      @case ('note') {
        <app-billet-rich-text class="note" [text]="block().text" />
      }
      @case ('divider') {
        <app-billet-divider [variant]="block().dividerStyle" />
      }
    }
  `,
  styleUrl: './billet-block.scss',
})
export class BilletBlock {
  readonly block = input.required<BilletBlockData>();
}
