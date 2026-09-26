import { Component } from '@angular/core';

import { AssetThumb } from '../../../shared/components/asset-thumb/asset-thumb';

/** A row of cards, each with its four actions (delete, duplicate, share, edit). */
const CARDS = [0, 1, 2] as const;

/**
 * The account's billets while they load (CLAUDE.md, "Loading states"): the count line and cards
 * with their model plane, title, meta line and actions, in BilletList's layout (its stylesheet),
 * so nothing moves when the billets arrive.
 */
@Component({
  selector: 'app-billet-list-skeleton',
  imports: [AssetThumb],
  templateUrl: './billet-list-skeleton.html',
  styleUrls: ['./billet-list.scss', './billet-card.scss'],
  host: { 'aria-hidden': 'true', class: 'ui-stack' },
})
export class BilletListSkeleton {
  protected readonly cards = CARDS;
}
