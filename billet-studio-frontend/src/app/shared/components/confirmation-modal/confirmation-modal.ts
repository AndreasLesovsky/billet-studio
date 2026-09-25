import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ConfirmationModalStore } from '../../../core/stores/confirmation-modal-store';
import { Modal } from '../../directives/modal';

/**
 * The app's one confirmation dialog, hosted by the root component and driven by
 * ConfirmationModalStore. The texts in the config are already translated by whoever asks.
 *
 * Cancel is focused first: for the destructive questions this dialog exists for, Enter must not
 * confirm by accident. While the confirmed action runs, nothing dismisses the dialog.
 */
@Component({
  selector: 'app-confirmation-modal',
  imports: [TranslatePipe, Modal],
  templateUrl: './confirmation-modal.html',
})
export class ConfirmationModal {
  protected readonly store = inject(ConfirmationModalStore);

  protected cancel(): void {
    if (this.store.isExecuting()) return;
    this.store.close();
  }

  protected confirm(): void {
    void this.store.confirm();
  }
}
