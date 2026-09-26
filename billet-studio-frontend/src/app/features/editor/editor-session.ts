import type { Signal, WritableSignal } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import type { ConfirmationModalStore } from '../../core/stores/confirmation-modal-store';

/** The open billet: shown, still loading, not there (any more), or its load failed. */
export type EditorPhase = 'loading' | 'ready' | 'missing' | 'failed';

/**
 * What the toolbar says about saving. `alert` is also read out, and so is the first `done` after
 * one; the routine `busy` of every pause in typing stays visual.
 */
export interface SaveIndicator {
  readonly tone: 'done' | 'busy' | 'alert';
  readonly icon: string;
  readonly key: string;
  readonly className: string;
}

/**
 * What stands between the billet and a share link: a guest signs in first, a billet on this
 * device goes into the account first, an account billet is shared.
 */
export type ShareMode = 'guest' | 'device' | 'account';

/**
 * changed / removed: another tab changed or removed this device's billet while this tab had edits.
 * conflict: the account billet was saved elsewhere while this editor had edits.
 * backup: this device kept edits of the account billet that its server copy lacks.
 */
export type RemoteChange = 'changed' | 'removed' | 'conflict' | 'backup';

/** A notice's two answers: the other version, or the one on screen. */
export type NoticeChoice = 'theirs' | 'mine';

/** Where the billet lives - this device or the account - as far as the editor needs to know. */
export interface EditorSession {
  readonly phase: Signal<EditorPhase>;
  readonly saveIndicator: Signal<SaveIndicator>;
  readonly shareMode: Signal<ShareMode>;
  /** A decision the user owes before saving goes on (or a version worth restoring). */
  readonly notice: Signal<RemoteChange | null>;
  /** The notice's answer that is running. */
  readonly resolving: Signal<NoticeChoice | null>;
  resolve(choice: NoticeChoice): Promise<void>;
  /** Asked by the route's canDeactivate. */
  confirmLeave(): boolean | Promise<boolean>;
}

/** The editor's side of a session. */
export interface EditorHost {
  readonly model: WritableSignal<BilletDocument>;
  /** Shows `document` as the billet's new start: loaded, reloaded or another tab's. */
  adopt(document: BilletDocument): void;
  /** Replaces the document as one undo step. */
  commit(update: (document: BilletDocument) => BilletDocument): void;
}

/** Leaving would lose edits that could be neither saved nor kept on this device: go anyway? */
export function askToLeaveUnsaved(
  confirmation: ConfirmationModalStore,
  translate: TranslateService,
): Promise<boolean> {
  return confirmation.askConfirmation({
    title: translate.instant('FORMS.UNSAVED_TITLE'),
    message: translate.instant('EDITOR.LEAVE_UNSAVED'),
    confirmLabel: translate.instant('FORMS.UNSAVED_DISCARD'),
    cancelLabel: translate.instant('FORMS.UNSAVED_STAY'),
    confirmVariant: 'danger',
  });
}
