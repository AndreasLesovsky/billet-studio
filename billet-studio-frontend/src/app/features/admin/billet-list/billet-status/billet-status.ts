import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminBilletDto } from '../../../../core/models/models';

/** A billet's status cell: a draft, published, or published but offline because its owner is locked. */
@Component({
  selector: 'app-billet-status',
  imports: [TranslatePipe],
  template: `
    @if (!billet().published) {
      <span class="ui-badge ui-badge--muted">{{ 'ADMIN_BILLETS.STATUS_DRAFT' | translate }}</span>
    } @else if (billet().owner.active) {
      <span class="ui-badge ui-badge--success">{{
        'ADMIN_BILLETS.STATUS_PUBLISHED' | translate
      }}</span>
    } @else {
      <span class="ui-badge ui-badge--warning">{{
        'ADMIN_BILLETS.STATUS_OFFLINE' | translate
      }}</span>
      <span class="ui-hint">{{ 'ADMIN_BILLETS.OFFLINE_HINT' | translate }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ui-space-1);
    }
  `,
})
export class BilletStatus {
  readonly billet = input.required<AdminBilletDto>();
}
