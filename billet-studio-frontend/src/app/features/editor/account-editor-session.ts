import { computed, DestroyRef, inject, Injector, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';

import type { BilletDocument } from '../../billet/billet-document';
import type {
  BilletDetailDto,
  BilletSaveResponse,
  PublishResponse,
} from '../../core/models/models';
import { AccountBackups } from '../../core/services/account-backups';
import { AuthApi } from '../../core/services/auth-api';
import { BilletApi } from '../../core/services/billet-api';
import { ConfirmationModalStore } from '../../core/stores/confirmation-modal-store';
import { apiErrorCode } from '../../core/utils/api-error';
import {
  NOT_SHARED,
  ShareFailure,
  shareFactsOf,
  type ShareFacts,
  type ShareTarget,
} from '../../shared/components/share-dialog/share-state';
import { isNewerThan, readBackup, removeBackup, type BilletBackup } from './billet-backup';
import { BilletSaveCoordinator, type SaveFailure, type SaveState } from './billet-save-coordinator';
import {
  askToLeaveUnsaved,
  type EditorHost,
  type EditorPhase,
  type EditorSession,
  type NoticeChoice,
  type RemoteChange,
  type SaveIndicator,
  type ShareMode,
} from './editor-session';

const SAVED: SaveIndicator = {
  tone: 'done',
  icon: 'bi-cloud-check',
  key: 'EDITOR.SAVE_STATUS.ACCOUNT_SAVED',
  className: 'ui-hint',
};
const SAVING: SaveIndicator = {
  tone: 'busy',
  icon: 'bi-hourglass-split',
  key: 'EDITOR.SAVE_STATUS.PENDING',
  className: 'ui-hint',
};
const FAILED: Readonly<Record<SaveFailure, SaveIndicator>> = {
  offline: {
    tone: 'alert',
    icon: 'bi-wifi-off',
    key: 'EDITOR.SAVE_STATUS.OFFLINE',
    className: 'ui-badge ui-badge--warning',
  },
  rejected: {
    tone: 'alert',
    icon: 'bi-exclamation-triangle',
    key: 'EDITOR.SAVE_STATUS.REJECTED',
    className: 'ui-badge ui-badge--danger',
  },
};
const CONFLICT: SaveIndicator = {
  tone: 'alert',
  icon: 'bi-exclamation-triangle',
  key: 'EDITOR.SAVE_STATUS.CONFLICT',
  className: 'ui-badge ui-badge--danger',
};

function indicatorOf(state: SaveState, failure: SaveFailure | null): SaveIndicator {
  if (state === 'conflict') return CONFLICT;
  if (state === 'error') return FAILED[failure ?? 'rejected'];
  return state === 'idle' ? SAVED : SAVING;
}

const isBilletId = (id: number) => Number.isSafeInteger(id) && id > 0;

/** The billet on screen, and whose it is: the user signed in when it opened. */
interface OpenBillet {
  readonly id: number;
  readonly userId: number;
}

/**
 * A billet of the signed-in user's account, /billets/:id/edit. Loads it (the editor shows its
 * skeleton meanwhile), saves it through a BilletSaveCoordinator, offers this device's backup when
 * it holds newer edits, and turns a save that lost the race into the conflict notice. Shares it:
 * a publish first saves what is on screen, so the snapshot is what the user sees. Construct it in
 * the editor's injection context.
 */
export class AccountEditorSession implements EditorSession {
  private readonly api = inject(BilletApi);
  private readonly auth = inject(AuthApi);
  private readonly injector = inject(Injector);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly backups = inject(AccountBackups);
  private readonly host: EditorHost;

  private readonly billetId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => Number(params.get('id')))),
    { requireSync: true },
  );
  private readonly coordinator = signal<BilletSaveCoordinator | null>(null);
  private readonly offered = signal<BilletBackup | null>(null);
  /** Deleted elsewhere, as found while resolving a conflict. */
  private readonly gone = signal(false);
  private readonly running = signal<NoticeChoice | null>(null);
  private readonly opened = signal<OpenBillet | null>(null);
  private readonly sharing = signal<ShareFacts>(NOT_SHARED);

  private readonly request = resource({
    params: () => this.billetId(),
    loader: async ({ params: id, abortSignal }) => {
      this.close();
      const userId = this.auth.user()?.id;
      if (userId === undefined || !isBilletId(id)) return null;
      const billet = await this.api.get(id);
      if (billet && !abortSignal.aborted) this.open(billet, userId);
      return billet;
    },
  });

  readonly phase = computed<EditorPhase>(() => {
    if (this.gone()) return 'missing';
    if (this.request.hasValue()) return this.request.value() ? 'ready' : 'missing';
    return this.request.status() === 'error' ? 'failed' : 'loading';
  });
  readonly saveIndicator = computed<SaveIndicator>(() => {
    const coordinator = this.coordinator();
    return coordinator ? indicatorOf(coordinator.state(), coordinator.failure()) : SAVED;
  });
  readonly shareMode = signal<ShareMode>('account').asReadonly();
  readonly notice = computed<RemoteChange | null>(() => {
    if (this.coordinator()?.state() === 'conflict') return 'conflict';
    return this.offered() ? 'backup' : null;
  });
  readonly resolving = this.running.asReadonly();

  /**
   * The open billet for the share dialog. Its facts follow every save and publish; an edit the
   * server does not have yet is an unpublished change already.
   */
  readonly shareTarget: ShareTarget = {
    title: computed(() => this.host.model().title),
    facts: computed(() => {
      const facts = this.sharing();
      const state = this.coordinator()?.state() ?? 'idle';
      return facts.published && state !== 'idle'
        ? { ...facts, hasUnpublishedChanges: true }
        : facts;
    }),
    publish: () => this.publish(),
    unpublish: () => this.unpublish(),
  };

  constructor(host: EditorHost) {
    this.host = host;
    inject(DestroyRef).onDestroy(this.backups.register(() => this.confirmLogout()));
  }

  /** After a failed load. */
  reload(): void {
    this.request.reload();
  }

  async resolve(choice: NoticeChoice): Promise<void> {
    const coordinator: BilletSaveCoordinator | null = this.coordinator();
    const opened = this.opened();
    if (!coordinator || !opened) return;
    if (this.notice() === 'backup') {
      this.answerBackup(choice, opened);
      return;
    }
    // Either answer to a conflict starts from the server's copy as it is now.
    this.running.set(choice);
    let latest: BilletDetailDto | null;
    try {
      latest = await this.api.get(opened.id);
    } catch {
      return; // errorInterceptor has said why; the notice stays for another try.
    } finally {
      this.running.set(null);
    }
    if (!latest) {
      this.close();
      this.gone.set(true);
      return;
    }
    this.sharing.set(shareFactsOf(latest));
    if (choice === 'theirs') {
      this.host.adopt(latest.document);
      coordinator.reset(latest.version, latest.document);
    } else {
      coordinator.keepMine(latest.version);
    }
  }

  /** Saves what is pending; asks only when it could be neither saved nor kept on this device. */
  confirmLeave(): boolean | Promise<boolean> {
    const coordinator = this.coordinator();
    if (!coordinator || coordinator.flush()) return true;
    return askToLeaveUnsaved(this.confirmation, this.translate);
  }

  /**
   * Before an explicit logout, which removes this device's backup too: saves what is pending and
   * waits for the answer; asks when it could not be saved.
   */
  private async confirmLogout(): Promise<boolean> {
    const coordinator = this.coordinator();
    if (!coordinator || (await coordinator.settled()) === 'idle') return true;
    return askToLeaveUnsaved(this.confirmation, this.translate);
  }

  private open(billet: BilletDetailDto, userId: number): void {
    this.host.adopt(billet.document);
    this.opened.set({ id: billet.id, userId });
    this.sharing.set(shareFactsOf(billet));
    const backup = readBackup(userId, billet.id);
    if (backup && isNewerThan(backup, billet)) this.offered.set(backup);
    else if (backup) removeBackup(userId, billet.id);
    this.coordinator.set(
      new BilletSaveCoordinator({
        billetId: billet.id,
        userId,
        version: billet.version,
        model: this.host.model,
        save: (version, document, refusedBefore) =>
          this.save(billet.id, version, document, refusedBefore),
        canSave: () => this.auth.user()?.id === userId,
        injector: this.injector,
      }),
    );
  }

  /** An autosave; its answer says whether the draft now differs from the published snapshot. */
  private async save(
    id: number,
    version: number,
    document: BilletDocument,
    refusedBefore: boolean,
  ): Promise<BilletSaveResponse> {
    const saved = await this.api.save(id, version, document, refusedBefore);
    this.sharing.update((facts) => ({
      ...facts,
      hasUnpublishedChanges: saved.hasUnpublishedChanges,
    }));
    return saved;
  }

  /**
   * Publishes what the editor shows: saved first, then published as of the version that save
   * returned. A version the server has moved past (saved elsewhere) is the conflict notice's to
   * resolve before publishing again.
   */
  private async publish(): Promise<void> {
    const coordinator = this.coordinator();
    const opened = this.opened();
    const state = coordinator ? await coordinator.settled() : null;
    // An open conflict holds every save until the notice is answered: that is what stands in the way.
    if (state === 'conflict') throw new ShareFailure('BILLET_MODIFIED_ELSEWHERE');
    if (!coordinator || !opened || state !== 'idle') throw new ShareFailure('BILLET_NOT_SAVED');
    let published: PublishResponse;
    try {
      published = await this.api.publish(opened.id, coordinator.version());
    } catch (error) {
      if (apiErrorCode(error) === 'BILLET_MODIFIED_ELSEWHERE') coordinator.markConflict();
      throw error;
    }
    this.sharing.set({
      published: true,
      hasUnpublishedChanges: false,
      shareToken: published.shareToken,
    });
  }

  private async unpublish(): Promise<void> {
    const opened = this.opened();
    if (!opened) return;
    await this.api.unpublish(opened.id);
    this.sharing.update((facts) => ({ ...facts, published: false, hasUnpublishedChanges: false }));
  }

  /** Flushes and forgets the billet that was open (another id arrived, or it is gone). */
  private close(): void {
    this.coordinator()?.dispose();
    this.coordinator.set(null);
    this.offered.set(null);
    this.opened.set(null);
    this.gone.set(false);
  }

  /** mine: the backup comes back as one undo step and is saved; theirs: it is dropped. */
  private answerBackup(choice: NoticeChoice, { id, userId }: OpenBillet): void {
    const backup = this.offered();
    this.offered.set(null);
    if (choice === 'mine' && backup) this.host.commit(() => backup.document);
    else removeBackup(userId, id);
  }
}
