import { Component, computed, inject, Injector, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import type { BilletSummaryDto } from '../../../core/models/models';
import { LanguageService } from '../../../core/services/language-service';
import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { runPendingFor } from '../../../core/utils/pending';
import { ShareDialog } from '../../../shared/components/share-dialog/share-dialog';
import type { ShareTarget } from '../../../shared/components/share-dialog/share-state';
import { AccountBillets } from './account-billets';
import { BilletCard, focusAfterDeletion } from './billet-card';
import { accountCardOf, accountLinkId } from './billet-list-state';

/**
 * The billets of the account, newest edit first: edit, share (the share dialog), duplicate
 * (within the account's places) and delete.
 */
@Component({
  selector: 'app-account-billet-grid',
  imports: [BilletCard, RouterLink, ShareDialog, TranslatePipe],
  templateUrl: './account-billet-grid.html',
  styleUrl: './billet-list.scss',
})
export class AccountBilletGrid {
  protected readonly account = inject(AccountBillets);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly injector = inject(Injector);

  readonly rows = input.required<readonly BilletSummaryDto[]>();
  /** The text that counts the account's places, which says why Duplicate is disabled. */
  readonly countId = input.required<string>();

  protected readonly cards = computed(() => {
    const locale = this.language.locale();
    const now = Date.now();
    return this.rows().map((row) => ({ row, view: accountCardOf(row, now, locale) }));
  });

  /** The billet whose copy is being made; the other copies wait. */
  protected readonly duplicating = signal<number | null>(null);
  /** The share dialog's billet while it is open. */
  protected readonly sharing = signal<ShareTarget | null>(null);

  protected async duplicate(row: BilletSummaryDto): Promise<void> {
    try {
      await runPendingFor(this.duplicating, row.id, () => this.account.duplicate(row.id));
    } catch {
      // errorInterceptor has said why.
    }
  }

  protected share(row: BilletSummaryDto): void {
    this.sharing.set(this.account.shareTarget(row));
  }

  protected remove(row: BilletSummaryDto): void {
    const title = row.title || this.translate.instant('BILLETS.UNTITLED');
    const message = row.published
      ? 'BILLETS.DELETE_PUBLISHED_MESSAGE'
      : 'BILLETS.DELETE_ACCOUNT_MESSAGE';
    this.confirmation.open({
      title: this.translate.instant('BILLETS.DELETE_TITLE'),
      message: this.translate.instant(message, { title }),
      confirmLabel: this.translate.instant('COMMON.DELETE'),
      pendingLabel: this.translate.instant('COMMON.PENDING.DELETING'),
      cancelLabel: this.translate.instant('COMMON.CANCEL'),
      confirmVariant: 'danger',
      onConfirm: async () => {
        const linkIds = this.cards().map((card) => card.view.linkId);
        await this.account.remove(row.id);
        focusAfterDeletion(linkIds, accountLinkId(row.id), this.injector);
      },
    });
  }
}
