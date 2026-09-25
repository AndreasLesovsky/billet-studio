import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { UserResponseDto } from '../../../../core/models/models';

/** An account's name cell, marked when it is the protected root account or the admin's own. */
@Component({
  selector: 'app-user-name',
  imports: [TranslatePipe],
  template: `
    {{ user().name }}
    @if (user().protectedAccount) {
      <span class="ui-badge ui-badge--muted">
        <i class="bi bi-lock-fill" aria-hidden="true"></i>
        {{ 'ADMIN_USERS.PROTECTED' | translate }}
      </span>
    }
    @if (self()) {
      <span class="ui-badge ui-badge--accent">{{ 'ADMIN_USERS.SELF' | translate }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ui-space-2);
    }
  `,
})
export class UserName {
  readonly user = input.required<UserResponseDto>();
  readonly self = input(false);
}
