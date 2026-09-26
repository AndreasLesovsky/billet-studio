import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { NoticeChoice, RemoteChange } from './editor-session';

interface NoticeTexts {
  readonly message: string;
  /** Null when there is no other version to take. */
  readonly theirs: string | null;
  readonly mine: string;
  /** The answer drawn tonal; the other one is neutral. */
  readonly suggested: NoticeChoice;
}

const TEXTS: Readonly<Record<RemoteChange, NoticeTexts>> = {
  changed: {
    message: 'EDITOR.REMOTE.CHANGED',
    theirs: 'EDITOR.REMOTE.LOAD_THEIRS',
    mine: 'EDITOR.REMOTE.KEEP_MINE',
    suggested: 'theirs',
  },
  removed: {
    message: 'EDITOR.REMOTE.REMOVED',
    theirs: null,
    mine: 'EDITOR.REMOTE.RESTORE',
    suggested: 'theirs',
  },
  conflict: {
    message: 'EDITOR.REMOTE.CONFLICT',
    theirs: 'EDITOR.REMOTE.RELOAD',
    mine: 'EDITOR.REMOTE.KEEP_MINE',
    suggested: 'theirs',
  },
  backup: {
    message: 'EDITOR.REMOTE.BACKUP',
    theirs: 'EDITOR.REMOTE.DISCARD_BACKUP',
    mine: 'EDITOR.REMOTE.RESTORE',
    suggested: 'mine',
  },
};

const PENDING_KEYS: Readonly<Record<NoticeChoice, string>> = {
  theirs: 'COMMON.LOADING',
  mine: 'COMMON.PENDING.SAVING',
};

/**
 * A version conflict the user decides: take the other version (when there is one) or keep the one
 * on screen, which is then written again. While an answer runs, both wait.
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
        @if (buttons().theirs; as theirs) {
          <button
            type="button"
            [class]="theirs.className"
            [disabled]="resolving() !== null"
            [attr.aria-busy]="resolving() === 'theirs'"
            (click)="loadTheirs.emit()"
          >
            {{ theirs.key | translate }}
          </button>
        }
        <button
          type="button"
          [class]="buttons().mine.className"
          [disabled]="resolving() !== null"
          [attr.aria-busy]="resolving() === 'mine'"
          (click)="keepMine.emit()"
        >
          {{ buttons().mine.key | translate }}
        </button>
      </div>
    </div>
  `,
})
export class EditorRemoteNotice {
  readonly change = input.required<RemoteChange>();
  readonly resolving = input<NoticeChoice | null>(null);
  readonly loadTheirs = output<void>();
  readonly keepMine = output<void>();

  protected readonly texts = computed(() => TEXTS[this.change()]);

  protected readonly buttons = computed(() => {
    const texts = this.texts();
    const resolving = this.resolving();
    const button = (choice: NoticeChoice, key: string) => ({
      key: resolving === choice ? PENDING_KEYS[choice] : key,
      className: `ui-btn ui-btn--sm ${choice === texts.suggested ? 'ui-btn--secondary' : 'ui-btn--neutral'}`,
    });
    return {
      theirs: texts.theirs === null ? null : button('theirs', texts.theirs),
      mine: button('mine', texts.mine),
    };
  });
}
