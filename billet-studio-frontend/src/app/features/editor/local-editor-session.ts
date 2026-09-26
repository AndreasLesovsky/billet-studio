import { computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import type { BilletDetailDto } from '../../core/models/models';
import { AuthApi } from '../../core/services/auth-api';
import { BilletApi } from '../../core/services/billet-api';
import { LocalBilletStore } from '../../core/services/local-billet-store';
import { ConfirmationModalStore } from '../../core/stores/confirmation-modal-store';
import { apiErrorCode } from '../../core/utils/api-error';
import { runPending } from '../../core/utils/pending';
import { writeBackup } from './billet-backup';
import { createEditorAutosave, type EditorAutosave, type SaveStatus } from './editor-autosave';
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

const INDICATORS: Readonly<Record<Exclude<SaveStatus, 'error'>, SaveIndicator>> = {
  saved: {
    tone: 'done',
    icon: 'bi-check2',
    key: 'EDITOR.SAVE_STATUS.SAVED',
    className: 'ui-hint',
  },
  pending: {
    tone: 'busy',
    icon: 'bi-hourglass-split',
    key: 'EDITOR.SAVE_STATUS.PENDING',
    className: 'ui-hint',
  },
  held: {
    tone: 'alert',
    icon: 'bi-pause-circle',
    key: 'EDITOR.SAVE_STATUS.HELD',
    className: 'ui-hint',
  },
};

/**
 * A billet stored on this device, /billets/local/:localId/edit - a guest's, or one a signed-in
 * user has not taken into the account yet. Autosaves to localStorage; another tab's change or
 * removal of the same billet becomes a notice while this tab has edits. Construct it in the
 * editor's injection context.
 */
export class LocalEditorSession implements EditorSession {
  private readonly store = inject(LocalBilletStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthApi);
  private readonly billetApi = inject(BilletApi);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly host: EditorHost;

  private readonly localId = signal(this.route.snapshot.paramMap.get('localId') ?? '');
  /** False for a localId this browser does not know: the page says so instead of editing. */
  private readonly found = signal(false);
  private readonly remote = signal<RemoteChange | null>(null);
  private readonly autosave: EditorAutosave;
  private readonly taking = signal(false);
  private readonly full = signal(false);

  readonly phase = computed<EditorPhase>(() => (this.found() ? 'ready' : 'missing'));
  readonly saveIndicator = computed<SaveIndicator>(() => {
    const status = this.autosave.status();
    if (status !== 'error') return INDICATORS[status];
    return {
      tone: 'alert',
      icon: 'bi-exclamation-triangle',
      key: `EDITOR.SAVE_STATUS.${this.autosave.failure() ?? 'LOCAL_STORAGE_UNAVAILABLE'}`,
      className: 'ui-badge ui-badge--danger',
    };
  });
  readonly shareMode = computed<ShareMode>(() => (this.auth.isLoggedIn() ? 'device' : 'guest'));
  readonly notice = this.remote.asReadonly();
  /** Both answers are instant here. */
  readonly resolving = signal<NoticeChoice | null>(null).asReadonly();

  /** Where a guest's sign-in comes back to: this billet, which can then go into the account. */
  readonly returnUrl = computed(() => `/billets/local/${this.localId()}/edit`);
  /** "Into my account" is running. */
  readonly takingOver = this.taking.asReadonly();
  /** The last attempt found the account full. */
  readonly accountFull = this.full.asReadonly();

  constructor(host: EditorHost) {
    this.host = host;
    const stored = this.store.load(this.localId());
    this.found.set(stored !== null);
    if (stored) host.adopt(stored);

    this.autosave = createEditorAutosave({
      model: host.model,
      save: (document) => this.store.save(this.localId(), document),
      enabled: this.found,
    });

    this.store.changedElsewhere.pipe(takeUntilDestroyed()).subscribe((localId) => {
      if (this.found() && (localId === null || localId === this.localId())) {
        this.onChangedElsewhere();
      }
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const localId = params.get('localId') ?? '';
      if (localId !== this.localId()) this.open(localId);
    });
  }

  resolve(choice: NoticeChoice): Promise<void> {
    if (choice === 'theirs') this.loadTheirs();
    else this.keepMine();
    return Promise.resolve();
  }

  /** The pending edit is written; only a failed write asks. */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.found() || this.autosave.flush()) return true;
    return askToLeaveUnsaved(this.confirmation, this.translate);
  }

  /**
   * Moves the billet into the signed-in user's account and opens it there; this device's copy
   * goes. Edits made while the request was out reach the account billet as its backup, which its
   * editor offers.
   */
  async takeOver(): Promise<void> {
    const document = this.host.model();
    this.full.set(false);
    let billet: BilletDetailDto;
    try {
      billet = await runPending(this.taking, () => this.billetApi.takeOver(document));
    } catch (error) {
      if (apiErrorCode(error) === 'BILLET_LIMIT_REACHED') this.full.set(true);
      return;
    }
    const latest = this.host.model();
    const userId = this.auth.user()?.id;
    if (latest !== document && userId !== undefined) {
      writeBackup(userId, billet.id, billet.version, latest);
    }
    // Nothing may write the device's copy back once it is gone.
    this.autosave.markSaved(latest);
    this.autosave.paused.set(true);
    this.store.remove(this.localId());
    await this.router.navigate(['/billets', billet.id, 'edit'], { replaceUrl: true });
  }

  /** Takes over another tab's version (dropping this tab's history). */
  private loadTheirs(): void {
    const theirs = this.store.load(this.localId());
    if (theirs) this.adopt(theirs);
  }

  /** Keeps this tab's version and writes it, over another tab's change or removal. */
  private keepMine(): void {
    this.remote.set(null);
    this.autosave.paused.set(false);
    this.autosave.flush(true);
  }

  /**
   * Another tab saved or removed this billet. Without edits here its version is taken over; with
   * edits, autosave holds and the user decides.
   */
  private onChangedElsewhere(): void {
    const theirs = this.store.load(this.localId());
    if (theirs !== null && JSON.stringify(theirs) === JSON.stringify(this.host.model())) {
      this.remote.set(null);
      this.autosave.paused.set(false);
    } else if (theirs !== null && this.autosave.status() === 'saved' && this.remote() === null) {
      this.adopt(theirs);
    } else {
      this.remote.set(theirs === null ? 'removed' : 'changed');
      this.autosave.paused.set(true);
    }
  }

  private adopt(document: BilletDocument): void {
    this.host.adopt(document);
    this.autosave.markSaved(document);
    this.remote.set(null);
    this.autosave.paused.set(false);
  }

  /** The route's localId changed while the editor stayed: save the old billet, open the new. */
  private open(localId: string): void {
    this.autosave.flush();
    const document = this.store.load(localId);
    this.localId.set(localId);
    this.found.set(document !== null);
    if (document) this.adopt(document);
  }
}
