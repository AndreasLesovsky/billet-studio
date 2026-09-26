import { Component, computed, input } from '@angular/core';

import type { BilletDocument } from '../../../billet/billet-document';
import { BilletView } from '../../../billet/view/billet-view';
import { insidePages } from './hero-capture-documents';

/**
 * Dev only (hero capture): the printed card's inside spread, two A6 pages with the fold between
 * them. The paper is the billet's light background (document data), bound inline.
 */
@Component({
  selector: 'app-hero-print-inside',
  imports: [BilletView],
  template: `
    @for (page of pages(); track page.side) {
      <div
        class="print-page"
        [class]="'print-page--' + page.side"
        [style.background-color]="paper()"
      >
        <app-billet-view
          class="print-page__billet"
          [document]="page.document"
          mode="light"
          [animate]="false"
          [particles]="false"
          fill="frame"
        />
      </div>
    }
  `,
  styleUrl: './hero-print.scss',
  host: { class: 'print-spread' },
})
export class HeroPrintInside {
  /** The template's own document. */
  readonly document = input.required<BilletDocument>();

  protected readonly pages = computed(() => {
    const { left, right } = insidePages(this.document());
    return [
      { side: 'left', document: left },
      { side: 'right', document: right },
    ];
  });

  protected readonly paper = computed(() => this.document().palette.light.background);
}
