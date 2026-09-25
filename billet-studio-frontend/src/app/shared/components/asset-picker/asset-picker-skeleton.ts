import { Component, input } from '@angular/core';

import { AssetThumb } from '../asset-thumb/asset-thumb';

/** A row of chips over two rows of tiles. */
const CHIPS = [0, 1, 2, 3] as const;
const TILES = [0, 1, 2, 3, 4, 5] as const;

/**
 * AssetPicker while its library loads (CLAUDE.md, "Loading states"): the legend, then occasion
 * chips and model tiles as skeletons, in AssetPicker's own layout (its stylesheet).
 */
@Component({
  selector: 'app-asset-picker-skeleton',
  imports: [AssetThumb],
  templateUrl: './asset-picker-skeleton.html',
  styleUrls: ['./asset-picker.scss', './asset-picker-skeleton.scss'],
})
export class AssetPickerSkeleton {
  /** The picker's legend text. */
  readonly label = input('');

  protected readonly chips = CHIPS;
  protected readonly tiles = TILES;
}
