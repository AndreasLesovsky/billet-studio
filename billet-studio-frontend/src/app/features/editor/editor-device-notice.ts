import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A signed-in user in a billet of this device: it can be shared only from the account, so this is
 * the way there. A full account says so and names where to make room.
 */
@Component({
  selector: 'app-editor-device-notice',
  imports: [RouterLink, TranslatePipe],
  host: {
    class: 'ui-alert ui-alert--info',
    role: 'region',
    'aria-labelledby': 'editor-device-title',
  },
  template: `
    <i class="bi bi-laptop" aria-hidden="true"></i>
    <div class="ui-stack ui-stack--sm">
      <strong id="editor-device-title" class="ui-alert__title">
        {{ 'EDITOR.DEVICE.TITLE' | translate }}
      </strong>
      <p role="status">{{ (full() ? 'EDITOR.DEVICE.FULL' : 'EDITOR.DEVICE.TEXT') | translate }}</p>
      <div class="ui-cluster">
        <button
          type="button"
          class="ui-btn ui-btn--primary ui-btn--sm"
          [disabled]="taking()"
          [attr.aria-busy]="taking()"
          (click)="takeOver.emit()"
        >
          <i class="bi bi-cloud-upload" aria-hidden="true"></i>
          {{ (taking() ? 'COMMON.PENDING.TAKING_OVER' : 'EDITOR.DEVICE.TAKE_OVER') | translate }}
        </button>
        @if (full()) {
          <a class="ui-btn ui-btn--neutral ui-btn--sm" routerLink="/billets">
            {{ 'EDITOR.NOT_FOUND_LINK' | translate }}
          </a>
        }
      </div>
    </div>
  `,
})
export class EditorDeviceNotice {
  readonly taking = input.required<boolean>();
  /** The last attempt found the account full. */
  readonly full = input.required<boolean>();
  readonly takeOver = output<void>();
}
