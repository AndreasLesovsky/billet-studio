import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { MAX_ACCOUNT_BILLETS } from '../../../core/services/billet-api';
import type { ImportOffer } from './billet-list-state';

/**
 * A signed-in user with billets on this device: they can be shared only from the account, so
 * this moves them all there in one step (all or nothing). An account without room for all of
 * them says how much is free, and the button waits.
 */
@Component({
  selector: 'app-billet-import-notice',
  imports: [TranslatePipe],
  host: {
    class: 'ui-alert ui-alert--info',
    role: 'region',
    'aria-labelledby': 'billet-import-title',
  },
  template: `
    <i class="bi bi-laptop" aria-hidden="true"></i>
    <div class="ui-stack ui-stack--sm">
      <strong id="billet-import-title" class="ui-alert__title">
        {{ titleKey() | translate: { count: offer().count } }}
      </strong>
      <p id="billet-import-text" role="status">
        {{ textKey() | translate: { free: offer().free, max: max } }}
      </p>
      <div>
        <button
          type="button"
          class="ui-btn ui-btn--primary ui-btn--sm"
          aria-describedby="billet-import-text"
          [disabled]="!offer().fits || importing()"
          [attr.aria-busy]="importing()"
          (click)="importAll.emit()"
        >
          <i class="bi bi-cloud-upload" aria-hidden="true"></i>
          {{ (importing() ? 'COMMON.PENDING.TAKING_OVER' : 'BILLETS.IMPORT.ACTION') | translate }}
        </button>
      </div>
    </div>
  `,
})
export class BilletImportNotice {
  readonly offer = input.required<ImportOffer>();
  readonly importing = input.required<boolean>();
  /** The last import found the account without room for all of them. */
  readonly refused = input.required<boolean>();
  readonly importAll = output<void>();

  protected readonly max = MAX_ACCOUNT_BILLETS;

  protected readonly titleKey = computed(() =>
    this.offer().count === 1 ? 'BILLETS.IMPORT.TITLE_ONE' : 'BILLETS.IMPORT.TITLE_OTHER',
  );

  /** Why the button waits, if it does; else what the account is good for. */
  protected readonly textKey = computed(() => {
    const { free, fits } = this.offer();
    if (free !== null && !fits) return 'BILLETS.IMPORT.NO_ROOM';
    return this.refused() ? 'BILLETS.IMPORT.REFUSED' : 'BILLETS.IMPORT.TEXT';
  });
}
