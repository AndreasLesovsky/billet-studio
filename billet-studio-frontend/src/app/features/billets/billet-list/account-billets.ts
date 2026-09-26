import { computed, inject, Injectable, linkedSignal, resource } from '@angular/core';

import type { BilletDocument } from '../../../billet/billet-document';
import type { BilletSummaryDto } from '../../../core/models/models';
import { AuthApi } from '../../../core/services/auth-api';
import { BilletApi, MAX_ACCOUNT_BILLETS } from '../../../core/services/billet-api';
import {
  ShareFailure,
  shareFactsOf,
  type ShareTarget,
} from '../../../shared/components/share-dialog/share-state';
import { summaryOf, type AccountRows } from './billet-list-state';

/**
 * The signed-in user's billets on "My billets": loaded with the page (keyed by the user; a guest
 * loads nothing) and kept current by the page's own actions instead of loading them again.
 * Provided by BilletList.
 */
@Injectable()
export class AccountBillets {
  private readonly api = inject(BilletApi);
  private readonly auth = inject(AuthApi);

  private readonly request = resource({
    params: () => this.auth.user()?.id,
    loader: () => this.api.list(),
  });

  readonly rows = computed<AccountRows>(() => {
    if (this.request.hasValue()) return this.request.value();
    return this.request.status() === 'error' ? 'failed' : 'loading';
  });

  /** No room for another billet: a copy has to wait until one is deleted. */
  readonly full = computed(() => {
    const rows = this.rows();
    return typeof rows !== 'string' && rows.length >= MAX_ACCOUNT_BILLETS;
  });

  /** After a failed load, or when the account changed elsewhere. What is shown stays meanwhile. */
  reload(): void {
    this.request.reload();
  }

  /** All or nothing; the new billets go on top of the list, and are returned newest first. */
  async import(documents: BilletDocument[]): Promise<BilletSummaryDto[]> {
    const { billets } = await this.api.import(documents);
    const newestFirst = [...billets].reverse();
    this.update((rows) => [...newestFirst, ...rows]);
    return newestFirst;
  }

  async duplicate(id: number): Promise<void> {
    const copy = await this.api.duplicate(id);
    this.update((rows) => [summaryOf(copy), ...rows]);
  }

  async remove(id: number): Promise<void> {
    await this.api.remove(id);
    this.update((rows) => rows.filter((row) => row.id !== id));
  }

  /** One row for the share dialog; it keeps its last state should the row leave the list. */
  shareTarget(row: BilletSummaryDto): ShareTarget {
    const current = linkedSignal<BilletSummaryDto | undefined, BilletSummaryDto>({
      source: () => {
        const rows = this.rows();
        return typeof rows === 'string' ? undefined : rows.find((r) => r.id === row.id);
      },
      computation: (found, previous) => found ?? previous?.value ?? row,
    });
    return {
      title: computed(() => current().title),
      facts: computed(() => shareFactsOf(current())),
      publish: () => this.publish(row.id),
      unpublish: () => this.unpublish(row.id),
    };
  }

  /** The draft as the account has it now: its version comes first. */
  private async publish(id: number): Promise<void> {
    const billet = await this.api.get(id);
    if (!billet) {
      this.reload();
      throw new ShareFailure('BILLET_NOT_FOUND');
    }
    const { shareToken, publishedAt } = await this.api.publish(id, billet.version);
    this.patch(id, { published: true, hasUnpublishedChanges: false, shareToken, publishedAt });
  }

  private async unpublish(id: number): Promise<void> {
    await this.api.unpublish(id);
    this.patch(id, { published: false, hasUnpublishedChanges: false, publishedAt: null });
  }

  private patch(id: number, changes: Partial<BilletSummaryDto>): void {
    this.update((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  private update(change: (rows: readonly BilletSummaryDto[]) => BilletSummaryDto[]): void {
    if (this.request.hasValue()) this.request.set(change(this.request.value()));
  }
}
