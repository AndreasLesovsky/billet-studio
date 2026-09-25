import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type RemoteChange = 'changed' | 'removed';

const TEXTS: Readonly<Record<RemoteChange, { message: string; keep: string }>> = {
  changed: { message: 'EDITOR.REMOTE.CHANGED', keep: 'EDITOR.REMOTE.KEEP_MINE' },
  removed: { message: 'EDITOR.REMOTE.REMOVED', keep: 'EDITOR.REMOTE.RESTORE' },
};

/**
 * Another tab changed or removed the open billet while this tab had edits: take the other version
 * (only after a change) or keep this one, which writes it again.
 */
@Component({
  selector: 'app-editor-remote-notice',
  imports: [TranslatePipe],
  host: { class: 'ui-alert ui-alert--warning', role: 'alert' },
  template: `
    <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
    <div class="ui-stack ui-stack--sm">
      <p>{{ texts().message | translate }}</p>
      <div class="ui-cluster">
        @if (change() === 'changed') {
          <button
            type="button"
            class="ui-btn ui-btn--secondary ui-btn--sm"
            (click)="loadTheirs.emit()"
          >
            {{ 'EDITOR.REMOTE.LOAD_THEIRS' | translate }}
          </button>
        }
        <button type="button" class="ui-btn ui-btn--neutral ui-btn--sm" (click)="keepMine.emit()">
          {{ texts().keep | translate }}
        </button>
      </div>
    </div>
  `,
})
export class EditorRemoteNotice {
  readonly change = input.required<RemoteChange>();
  readonly loadTheirs = output<void>();
  readonly keepMine = output<void>();

  protected readonly texts = computed(() => TEXTS[this.change()]);
}
