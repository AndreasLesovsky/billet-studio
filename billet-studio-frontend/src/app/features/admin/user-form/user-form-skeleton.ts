import { Component } from '@angular/core';

import { FieldSkeleton } from '../../../shared/components/field-skeleton/field-skeleton';

const FOOTER_ACTIONS = [0, 1, 2] as const;

/**
 * UserForm while an account and the roles load (CLAUDE.md, "Loading states"), in its layout (its
 * stylesheet): name, email, password (its hint has two lines when editing), role and language side
 * by side, the active switch with its hint, and the footer's three actions.
 */
@Component({
  selector: 'app-user-form-skeleton',
  imports: [FieldSkeleton],
  template: `
    <div class="ui-card user-form__card">
      <div class="ui-card__body ui-stack">
        <app-field-skeleton />
        <app-field-skeleton />
        <app-field-skeleton [hints]="2" />
        <div class="user-form__row">
          <app-field-skeleton [errorSlot]="false" />
          <app-field-skeleton [errorSlot]="false" />
        </div>
        <div class="ui-field">
          <span class="ui-check">
            <span class="ui-skeleton ui-skeleton--pill user-form__skeleton-switch"></span>
            <span class="ui-skeleton ui-skeleton--text user-form__skeleton-label"></span>
          </span>
          <span class="ui-hint ui-skeleton ui-skeleton--text ui-skeleton--medium"></span>
        </div>
      </div>
      <div class="ui-card__footer">
        @for (action of actions; track action) {
          <span class="ui-skeleton ui-skeleton--button"></span>
        }
      </div>
    </div>
  `,
  styleUrls: ['./user-form.scss', './user-form-skeleton.scss'],
  host: { 'aria-hidden': 'true' },
})
export class UserFormSkeleton {
  protected readonly actions = FOOTER_ACTIONS;
}
