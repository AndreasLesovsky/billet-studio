import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletSummaryDto } from '../../../core/models/models';
import { MAX_ACCOUNT_BILLETS } from '../../../core/services/billet-api';
import { AccountBilletGrid } from './account-billet-grid';
import { AccountBillets } from './account-billets';
import { BilletListEmpty } from './billet-list-empty';
import { BilletListSkeleton } from './billet-list-skeleton';

/**
 * "In your account" on My billets: a skeleton while the billets load, an alert with Retry when
 * that failed, then how many places are used and the billets - or that there are none yet.
 */
@Component({
  selector: 'app-account-billet-section',
  imports: [AccountBilletGrid, BilletListEmpty, BilletListSkeleton, TranslatePipe],
  templateUrl: './account-billet-section.html',
  host: {
    class: 'ui-stack',
    role: 'region',
    'aria-labelledby': 'billet-list-account-title',
    '[attr.aria-busy]': "view() === 'loading'",
  },
})
export class AccountBilletSection {
  protected readonly account = inject(AccountBillets);
  protected readonly max = MAX_ACCOUNT_BILLETS;

  protected readonly view = computed(() => {
    const rows = this.account.rows();
    if (typeof rows === 'string') return rows;
    return rows.length > 0 ? 'billets' : 'empty';
  });
  protected readonly rows = computed<readonly BilletSummaryDto[]>(() => {
    const rows = this.account.rows();
    return typeof rows === 'string' ? [] : rows;
  });
}
