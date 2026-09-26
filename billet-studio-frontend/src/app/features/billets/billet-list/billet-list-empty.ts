import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** No billets (yet) where the list looks: the brand mark and what will appear here. */
@Component({
  selector: 'app-billet-list-empty',
  imports: [TranslatePipe],
  host: { class: 'ui-card', role: 'region', '[attr.aria-labelledby]': 'titleId()' },
  template: `
    <div class="ui-card__body ui-stack billet-list-empty">
      <span class="ui-brand-mark ui-brand-mark--lg" aria-hidden="true"></span>
      @if (level() === 2) {
        <h2 class="ui-card__title" [id]="titleId()">{{ 'BILLETS.EMPTY_TITLE' | translate }}</h2>
      } @else {
        <h3 class="ui-card__title" [id]="titleId()">{{ 'BILLETS.EMPTY_TITLE' | translate }}</h3>
      }
      <p class="ui-hint">{{ textKey() | translate }}</p>
    </div>
  `,
  styles: `
    .billet-list-empty {
      align-items: center;
      max-inline-size: 32rem;
      margin-inline: auto;
      padding-block: var(--ui-space-8);
      text-align: center;
    }
  `,
})
export class BilletListEmpty {
  readonly textKey = input.required<string>();
  /** 2 on a guest's page, 3 under the account's heading. */
  readonly level = input<2 | 3>(2);
  readonly titleId = input.required<string>();
}
