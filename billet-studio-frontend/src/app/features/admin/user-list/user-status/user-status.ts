import { DatePipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { UserResponseDto } from '../../../../core/models/models';
import { LanguageService } from '../../../../core/services/language-service';

/** An account's status cell: active or locked, and for a locked one why and until when. */
@Component({
  selector: 'app-user-status',
  imports: [DatePipe, TranslatePipe],
  template: `
    @if (user().active) {
      <span class="ui-badge ui-badge--success">{{ 'ADMIN_USERS.STATUS_ACTIVE' | translate }}</span>
    } @else {
      <span class="ui-badge ui-badge--danger">{{ 'ADMIN_USERS.STATUS_INACTIVE' | translate }}</span>
      @if (user().deactivationReason; as reason) {
        <span class="ui-hint">{{ 'DEACTIVATION_REASON.' + reason | translate }}</span>
      }
      @if (user().deletionScheduledAt; as deletion) {
        <span class="ui-hint">{{
          'ADMIN_USERS.DELETION_SCHEDULED'
            | translate: { date: (deletion | date: 'mediumDate' : undefined : locale()) }
        }}</span>
      }
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
export class UserStatus {
  readonly user = input.required<UserResponseDto>();

  protected readonly locale = inject(LanguageService).locale;
}
