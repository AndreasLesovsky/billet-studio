import { Component, computed, input } from '@angular/core';

import type { BilletDocument } from '../../../billet/billet-document';
import { BilletView } from '../../../billet/view/billet-view';
import { frontDocument } from './hero-capture-documents';

/**
 * Dev only (hero capture): the printed card's front - the billet's hero centred on paper in its
 * soft accent, inside a fine printed frame. The paper and frame colours are the billet's light
 * palette (document data), bound inline.
 */
@Component({
  selector: 'app-hero-print-front',
  imports: [BilletView],
  template: `
    <div class="print-page print-page--front" [style.background-color]="paper().background">
      <span class="print-page__rule" [style.border-color]="paper().border"></span>
      <app-billet-view
        class="print-page__billet"
        [document]="front()"
        mode="light"
        [animate]="false"
        [particles]="false"
        fill="frame"
      />
    </div>
  `,
  styleUrl: './hero-print.scss',
})
export class HeroPrintFront {
  /** The template's own document. */
  readonly document = input.required<BilletDocument>();

  protected readonly front = computed(() => frontDocument(this.document()));
  protected readonly paper = computed(() => this.front().palette.light);
}
