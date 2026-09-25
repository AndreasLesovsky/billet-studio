import { Component } from '@angular/core';

import { FieldSkeleton } from '../../shared/components/field-skeleton/field-skeleton';

const PICTURE_ACTIONS = [0, 1, 2, 3] as const;

/**
 * The account page while the account loads without a copy to show (CLAUDE.md, "Loading states"):
 * its four cards as they will stand - profile and password with their fields and hints, picture
 * and deactivation - in Account's layout (its stylesheet).
 */
@Component({
  selector: 'app-account-skeleton',
  imports: [FieldSkeleton],
  templateUrl: './account-skeleton.html',
  styleUrls: ['./account.scss', './account-skeleton.scss'],
  host: { 'aria-hidden': 'true' },
})
export class AccountSkeleton {
  protected readonly pictureActions = PICTURE_ACTIONS;
}
