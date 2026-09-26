import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The editor's place when there is nothing to edit: a card that says why, with the way to the
 * list (a billet that is not there, a full account) - or, `retryable`, a failed load's alert.
 */
@Component({
  selector: 'app-editor-message',
  imports: [RouterLink, TranslatePipe],
  template: `
    <div class="ui-container">
      <div class="ui-page">
        @if (retryable()) {
          <div class="ui-alert ui-alert--danger" role="alert">
            <i class="bi bi-exclamation-octagon" aria-hidden="true"></i>
            <div class="ui-stack ui-stack--sm">
              <p>{{ textKey() | translate }}</p>
              <div>
                <button
                  type="button"
                  class="ui-btn ui-btn--neutral ui-btn--sm"
                  (click)="retry.emit()"
                >
                  <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
                  {{ 'COMMON.RETRY' | translate }}
                </button>
              </div>
            </div>
          </div>
        } @else {
          <section class="ui-card" aria-labelledby="editor-message-title">
            <div class="ui-card__body ui-stack message">
              <span class="ui-brand-mark ui-brand-mark--lg" aria-hidden="true"></span>
              <h1 id="editor-message-title" class="ui-card__title">{{ titleKey() | translate }}</h1>
              <p class="ui-hint">{{ textKey() | translate }}</p>
              <a class="ui-btn ui-btn--primary" routerLink="/billets">
                {{ 'EDITOR.NOT_FOUND_LINK' | translate }}
              </a>
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    .message {
      align-items: center;
      padding-block: var(--ui-space-8);
      text-align: center;
    }
  `,
})
export class EditorMessage {
  /** The card's heading; a retryable alert has none. */
  readonly titleKey = input('');
  readonly textKey = input.required<string>();
  readonly retryable = input(false);
  readonly retry = output<void>();
}
