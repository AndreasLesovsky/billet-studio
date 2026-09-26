import {
  afterNextRender,
  Component,
  computed,
  DOCUMENT,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletSummaryDto } from '../../../core/models/models';
import { AuthApi } from '../../../core/services/auth-api';
import { LocalBilletStore, MAX_LOCAL_BILLETS } from '../../../core/services/local-billet-store';
import { MessageStore } from '../../../core/stores/message-store';
import { apiErrorCode } from '../../../core/utils/api-error';
import { runPending } from '../../../core/utils/pending';
import { AccountBilletSection } from './account-billet-section';
import { AccountBillets } from './account-billets';
import { NEW_BILLET_ID } from './billet-card';
import { BilletImportNotice } from './billet-import-notice';
import { BilletListEmpty } from './billet-list-empty';
import { accountLinkId, importBatch, importOffer } from './billet-list-state';
import { LocalBilletGrid, writeLocally } from './local-billet-grid';

/**
 * "My billets". A guest's are the billets stored in this browser. A signed-in user sees the
 * account's billets (a skeleton while they load) and, below them, any this device still holds,
 * with the notice that moves them all into the account - then the page's main action, so
 * "New billet" steps back.
 */
@Component({
  selector: 'app-billet-list',
  imports: [
    AccountBilletSection,
    BilletImportNotice,
    BilletListEmpty,
    LocalBilletGrid,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './billet-list.html',
  styleUrl: './billet-list.scss',
  providers: [AccountBillets],
})
export class BilletList {
  private readonly store = inject(LocalBilletStore);
  private readonly messages = inject(MessageStore);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly account = inject(AccountBillets);

  protected readonly signedIn = inject(AuthApi).isLoggedIn;
  protected readonly newBilletId = NEW_BILLET_ID;
  protected readonly maxLocal = MAX_LOCAL_BILLETS;
  protected readonly localCount = computed(() => this.store.list().length);

  /** Billets of this device a signed-in user can move into the account; null when there are none. */
  protected readonly offer = computed(() =>
    this.signedIn() ? importOffer(this.localCount(), this.account.rows()) : null,
  );
  protected readonly importing = signal(false);
  /** The last import found the account without room for all of them. */
  protected readonly importRefused = signal(false);

  /** Moves this device's billets into the account (all or nothing); their device copies go. */
  protected async importAll(): Promise<void> {
    const { localIds, documents } = importBatch(this.store.list(), (localId) =>
      this.store.load(localId),
    );
    if (documents.length === 0) return;
    this.importRefused.set(false);
    let imported: BilletSummaryDto[];
    try {
      imported = await runPending(this.importing, () => this.account.import(documents));
    } catch (error) {
      // BILLET_LIMIT_REACHED is answered here; anything else has been toasted, by errorInterceptor
      // or - for no answer at all - by AccountBillets.
      if (apiErrorCode(error) === 'BILLET_LIMIT_REACHED') {
        this.importRefused.set(true);
        this.account.reload();
      }
      return;
    }
    writeLocally(this.messages, () => localIds.forEach((localId) => this.store.remove(localId)));
    if (this.localCount() === 0) this.focusBillet(imported[0]);
  }

  /** The notice went with the button just pressed: the focus goes to the newest billet moved. */
  private focusBillet({ id }: BilletSummaryDto): void {
    afterNextRender(() => this.document.getElementById(accountLinkId(id))?.focus(), {
      injector: this.injector,
    });
  }
}
