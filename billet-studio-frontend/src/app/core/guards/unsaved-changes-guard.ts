import { inject, Signal } from '@angular/core';
import { type CanDeactivateFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthApi } from '../services/auth-api';
import { ConfirmationModalStore } from '../stores/confirmation-modal-store';

/** `canUndo` is the dirty check every form already exposes (see core/forms/model-undo.ts). */
export interface HasUnsavedChanges {
  readonly canUndo: Signal<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = async (component) => {
  // A session that has ended must never be held on a protected route, so the question is skipped
  // rather than asked - the work is kept by UnsavedWork at that point, not by staying put.
  if (!inject(AuthApi).isLoggedIn()) return true;
  if (!component.canUndo()) return true;

  const translate = inject(TranslateService);
  return inject(ConfirmationModalStore).askConfirmation({
    title: translate.instant('FORMS.UNSAVED_TITLE'),
    message: translate.instant('FORMS.UNSAVED_MESSAGE'),
    confirmLabel: translate.instant('FORMS.UNSAVED_DISCARD'),
    cancelLabel: translate.instant('FORMS.UNSAVED_STAY'),
    confirmVariant: 'danger',
  });
};
