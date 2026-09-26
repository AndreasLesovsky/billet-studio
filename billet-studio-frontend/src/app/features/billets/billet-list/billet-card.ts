import { afterNextRender, Component, DOCUMENT, input, type Injector } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';
import { PublishBadge } from '../../../shared/components/share-dialog/publish-badge';
import type { BilletCardView } from './billet-list-state';

/** The page's "New billet" link, where the focus goes when the last card is deleted. */
export const NEW_BILLET_ID = 'billet-list-new';

/**
 * A card's delete took it and its buttons away: the focus goes to the card that took its place,
 * else to the one before it, else to "New billet". `linkIds` are the cards' edit links before the
 * deletion.
 */
export function focusAfterDeletion(
  linkIds: readonly string[],
  deleted: string,
  injector: Injector,
): void {
  const index = linkIds.indexOf(deleted);
  const next = linkIds[index + 1] ?? linkIds[index - 1] ?? NEW_BILLET_ID;
  afterNextRender(() => injector.get(DOCUMENT).getElementById(next)?.focus(), { injector });
}

/**
 * One billet of "My billets": its model, title, theme colours, when it was last edited and its
 * publish state. The actions are the owner's, projected into the footer.
 */
@Component({
  selector: 'app-billet-card',
  imports: [AssetThumb, PublishBadge, TranslatePipe],
  host: { class: 'ui-card' },
  template: `
    <app-asset-thumb
      [src]="card().preview.src"
      [pending]="card().preview.pending"
      [emoji]="card().emoji"
    />
    <div class="ui-card__body ui-stack ui-stack--sm">
      @let name = card().title || ('BILLETS.UNTITLED' | translate);
      @if (level() === 2) {
        <h2 class="ui-card__title billet-card__title">{{ name }}</h2>
      } @else {
        <h3 class="ui-card__title billet-card__title">{{ name }}</h3>
      }
      <p class="ui-hint ui-cluster billet-card__meta">
        @if (card().swatches.length > 0) {
          <span class="billet-card__swatches" aria-hidden="true">
            @for (color of card().swatches; track $index) {
              <span class="ui-swatch" [style.background-color]="color"></span>
            }
          </span>
        }
        <span>{{ 'BILLETS.EDITED' | translate: { when: card().edited } }}</span>
        <app-publish-badge [facts]="card().facts" />
      </p>
    </div>
    <div class="ui-card__footer billet-card__actions">
      <ng-content />
    </div>
  `,
  styleUrl: './billet-card.scss',
})
export class BilletCard {
  readonly card = input.required<BilletCardView>();
  /** 2 on a page of cards, 3 under a section heading. */
  readonly level = input<2 | 3>(2);
}
