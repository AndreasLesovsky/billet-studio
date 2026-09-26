import { Component, computed, inject, Injector, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TEXT_LIMITS } from '../../../billet/billet-limits';
import { truncateGraphemes } from '../../../billet/text/text-sanitize';
import { LanguageService } from '../../../core/services/language-service';
import {
  LocalBilletError,
  LocalBilletStore,
  MAX_LOCAL_BILLETS,
  type LocalBilletEntry,
} from '../../../core/services/local-billet-store';
import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { MessageStore } from '../../../core/stores/message-store';
import { ColorModeService } from '../../../core/theme/color-mode-service';
import { injectCatalogPreviews } from '../../../core/utils/model-previews';
import { BilletCard, focusAfterDeletion } from './billet-card';
import { localCardOf, localLinkId } from './billet-list-state';

/** A write the device refused becomes its toast; true when it went through. */
export function writeLocally(messages: MessageStore, write: () => unknown): boolean {
  try {
    write();
    return true;
  } catch (error) {
    if (!(error instanceof LocalBilletError)) throw error;
    messages.addMessage('error', error.code, undefined, { max: MAX_LOCAL_BILLETS });
    return false;
  }
}

/**
 * The billets stored in this browser, newest first, with their model, theme colours and when they
 * were last edited: edit, duplicate (within the device's places) and delete. Other tabs' changes
 * show up by themselves (LocalBilletStore).
 */
@Component({
  selector: 'app-local-billet-grid',
  imports: [BilletCard, RouterLink, TranslatePipe],
  templateUrl: './local-billet-grid.html',
  styleUrl: './billet-list.scss',
})
export class LocalBilletGrid {
  private readonly store = inject(LocalBilletStore);
  private readonly colorMode = inject(ColorModeService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly messages = inject(MessageStore);
  private readonly injector = inject(Injector);

  /** 2 on a guest's page, 3 under the "only on this device" heading. */
  readonly level = input<2 | 3>(2);
  /** The text that counts the device's places, which says why Duplicate is disabled. */
  readonly countId = input.required<string>();

  /** Every place is taken: a copy has no room (the count says so). */
  protected readonly full = computed(() => this.store.list().length >= MAX_LOCAL_BILLETS);

  /** The billets are this device's; only their model previews come from the server. */
  private readonly previews = injectCatalogPreviews();

  protected readonly cards = computed(() => {
    const previews = this.previews();
    const mode = this.colorMode.resolvedMode();
    const locale = this.language.locale();
    const now = Date.now();
    return this.store.list().map((entry) => ({
      entry,
      view: localCardOf(entry, previews, mode, now, locale),
    }));
  });

  protected duplicate(entry: LocalBilletEntry): void {
    const title = this.translate.instant('BILLETS.COPY_TITLE', { title: this.nameOf(entry) });
    writeLocally(this.messages, () =>
      this.store.duplicate(entry.localId, truncateGraphemes(title, TEXT_LIMITS.title)),
    );
  }

  protected async remove(entry: LocalBilletEntry): Promise<void> {
    const confirmed = await this.confirmation.askConfirmation({
      title: this.translate.instant('BILLETS.DELETE_TITLE'),
      message: this.translate.instant('BILLETS.DELETE_MESSAGE', { title: this.nameOf(entry) }),
      confirmLabel: this.translate.instant('COMMON.DELETE'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const linkIds = this.cards().map((card) => card.view.linkId);
    if (writeLocally(this.messages, () => this.store.remove(entry.localId))) {
      focusAfterDeletion(linkIds, localLinkId(entry.localId), this.injector);
    }
  }

  private nameOf(entry: LocalBilletEntry): string {
    return entry.title || this.translate.instant('BILLETS.UNTITLED');
  }
}
