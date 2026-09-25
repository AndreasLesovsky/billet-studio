import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import { parseInlineMarkup } from '../text/inline-markup';

/**
 * Billet text as elements: the inline-markup nodes become <p>, <em>, <strong> and <br> through
 * @for/@switch - never innerHTML. A blank line is a new paragraph, one line box apart like the
 * live card's <br><br>. `inline` (for headings) joins the paragraphs with a line break instead.
 * The `card` variant sets **strong** upright in ink, as on the live card's fun card.
 */
@Component({
  selector: 'app-billet-rich-text',
  imports: [NgTemplateOutlet],
  host: {
    '[attr.data-inline]': 'inline() ? "" : null',
    '[attr.data-variant]': 'variant()',
  },
  template: `
    <ng-template #inlineNodes let-nodes>
      @for (node of nodes; track $index) {
        @switch (node.type) {
          @case ('text') {
            <span>{{ node.text }}</span>
          }
          @case ('break') {
            <br />
          }
          @case ('em') {
            <em>
              <ng-container
                *ngTemplateOutlet="inlineNodes; context: { $implicit: node.children }"
              />
            </em>
          }
          @case ('strong') {
            <strong>
              <ng-container
                *ngTemplateOutlet="inlineNodes; context: { $implicit: node.children }"
              />
            </strong>
          }
        }
      }
    </ng-template>

    @for (paragraph of paragraphs(); track $index) {
      @if (inline()) {
        @if (!$first) {
          <br />
        }
        <ng-container *ngTemplateOutlet="inlineNodes; context: { $implicit: paragraph }" />
      } @else {
        <p>
          <ng-container *ngTemplateOutlet="inlineNodes; context: { $implicit: paragraph }" />
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }

    :host([data-inline]) {
      display: inline;
    }

    // The site's element rules (text-wrap: pretty, a themed strong weight, ::selection) stop here.
    p {
      text-wrap: wrap;
    }

    p + p {
      margin-block-start: 1lh;
    }

    em {
      font-style: italic;
      color: var(--billet-emphasis);
    }

    strong {
      font-weight: bolder;
    }

    ::selection {
      background-color: Highlight;
      color: HighlightText;
    }

    :host([data-variant='card']) strong {
      font-style: normal;
      font-weight: var(--billet-weight-body);
      color: var(--billet-ink);
    }
  `,
})
export class RichText {
  readonly text = input.required<string>();
  readonly inline = input(false);
  readonly variant = input<'text' | 'card'>('text');

  protected readonly paragraphs = computed(() => parseInlineMarkup(this.text()));
}
