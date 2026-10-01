import { Component, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { ModelAssetDto } from '../../../core/models/models';
import { AssistConversationStore } from '../../../core/stores/assist-conversation-store';
import { AssistOffer } from './assist-offer';

/**
 * The billet assistant's messages (.ui-chat, inside the window's polite log): the user's - a failed
 * one with its reason and a retry -, the assistant's notes and offers, and its "thinking" dots.
 */
@Component({
  selector: 'app-assist-log',
  imports: [AssistOffer, TranslatePipe],
  templateUrl: './assist-log.html',
})
export class AssistLog {
  protected readonly conversation = inject(AssistConversationStore);

  readonly library = input.required<readonly ModelAssetDto[]>();
  readonly libraryPending = input(false);
  /** The assistant cannot answer right now (offline): a retry would fail the same way. */
  readonly retryDisabled = input(false);
  /** A failed message (its id) is to be sent again. */
  readonly retry = output<number>();
}
