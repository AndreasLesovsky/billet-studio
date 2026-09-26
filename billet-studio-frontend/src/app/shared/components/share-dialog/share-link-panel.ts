import { Component, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { MessageStore } from '../../../core/stores/message-store';
import { copyText } from '../../../core/utils/clipboard';
import { PublishBadge } from './publish-badge';
import type { ShareFacts } from './share-state';

/**
 * The share dialog's published view: the link to copy, open or hand to the system's share sheet,
 * and whether it still shows the current draft ("Publish changes" when it does not).
 */
@Component({
  selector: 'app-share-link-panel',
  imports: [PublishBadge, TranslatePipe],
  templateUrl: './share-link-panel.html',
  styleUrl: './share-link-panel.scss',
  host: { class: 'ui-stack' },
})
export class ShareLinkPanel {
  private readonly messages = inject(MessageStore);

  readonly link = input.required<string>();
  readonly title = input.required<string>();
  readonly facts = input.required<ShareFacts>();
  /** A publish runs (this panel's "Publish changes"). */
  readonly publishing = input.required<boolean>();

  readonly publishChanges = output<void>();
  /** An outcome for the dialog's live region, as an i18n key. */
  readonly announce = output<string>();

  protected readonly canShareNatively = typeof navigator.share === 'function';

  protected async copy(field: HTMLInputElement): Promise<void> {
    if ((await copyText(this.link(), field)) === 'copied') {
      this.messages.addMessage('success', 'LINK_COPIED');
      this.announce.emit('SHARE.STATUS.COPIED');
    } else {
      this.announce.emit('SHARE.STATUS.SELECTED');
    }
  }

  protected async shareNatively(): Promise<void> {
    try {
      await navigator.share({ title: this.title(), url: this.link() });
    } catch {
      // Cancelled, or the share sheet could not open: the link and its copy button are right here.
    }
  }
}
