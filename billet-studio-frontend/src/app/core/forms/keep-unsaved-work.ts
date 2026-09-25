import { DestroyRef, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { UnsavedWork, UnsavedWorkSource } from '../services/unsaved-work';
import { ConfirmationModalStore } from '../stores/confirmation-modal-store';

export interface UnsavedWorkControl {
  /**
   * Offers back whatever was kept, once. Call it AFTER the initial load: in edit mode the arriving
   * entity would otherwise overwrite what was just restored.
   */
  offerKept<T>(apply: (bundle: T) => void): Promise<void>;
}

/**
 * Registers a form's work for the lifetime of the calling component; call it in a field initializer,
 * the way createModelUndo is called.
 */
export function keepUnsavedWork(routeKey: string, source: UnsavedWorkSource): UnsavedWorkControl {
  const unsavedWork = inject(UnsavedWork);
  const confirmationModalStore = inject(ConfirmationModalStore);
  const translate = inject(TranslateService);

  unsavedWork.register(routeKey, source);
  inject(DestroyRef).onDestroy(() => unsavedWork.unregister(routeKey));

  return {
    async offerKept<T>(apply: (bundle: T) => void): Promise<void> {
      const kept = unsavedWork.reclaim(routeKey) as T | null;
      if (kept === null) return;

      const restore = await confirmationModalStore.askConfirmation({
        title: translate.instant('FORMS.KEPT_WORK_TITLE'),
        message: translate.instant('FORMS.KEPT_WORK_MESSAGE'),
        confirmLabel: translate.instant('FORMS.KEPT_WORK_RESTORE'),
        cancelLabel: translate.instant('FORMS.KEPT_WORK_DISCARD'),
        confirmVariant: 'primary',
      });
      if (restore) apply(kept);
    },
  };
}
