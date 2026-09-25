import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, model, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { USER_DEACTIVATION_REASONS } from '../../../core/models/models';
import { AccountApi } from '../../../core/services/account-api';
import { runPending } from '../../../core/utils/pending';
import { Modal } from '../../directives/modal';
import { PasswordToggle } from '../../directives/password-toggle';
import { FieldError } from '../field-error/field-error';
import {
  DeactivateAccountFormModel,
  deactivateAccountSchema,
  EMPTY_MODEL,
  toDeactivateDto,
} from './deactivate-account-modal-schema';

/**
 * Deactivates the signed-in account after asking for its password and, optionally, why. On success
 * AccountApi ends the session and leaves for the login page, taking this dialog with the page.
 *
 * A failure is also shown inside the dialog: the page behind a modal is inert, the toasts included,
 * so a screen reader would never hear why the password was refused.
 */
@Component({
  selector: 'app-deactivate-account-modal',
  imports: [FieldError, FormField, Modal, PasswordToggle, TranslatePipe],
  templateUrl: './deactivate-account-modal.html',
})
export class DeactivateAccountModal {
  private readonly accountApi = inject(AccountApi);

  /** Two-way: the owner opens it, the dialog closes itself on cancel. */
  readonly open = model(false);

  protected readonly reasons = USER_DEACTIVATION_REASONS;

  readonly model = signal<DeactivateAccountFormModel>({ ...EMPTY_MODEL });
  readonly deactivateForm = form(this.model, deactivateAccountSchema);

  /** errorCode of the last failed attempt. */
  readonly failure = signal<string | null>(null);
  /** The request runs: nothing closes the dialog meanwhile. */
  readonly deactivating = signal(false);

  cancel(): void {
    if (this.deactivating()) return;
    this.open.set(false);
  }

  /** Off screen: the next opening starts empty, the password first of all. */
  onClosed(): void {
    this.deactivateForm().reset({ ...EMPTY_MODEL });
    this.failure.set(null);
  }

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.deactivateForm().invalid()) {
      this.deactivateForm().markAsTouched();
      return;
    }

    this.failure.set(null);
    try {
      await runPending(this.deactivating, () =>
        this.accountApi.deactivate(toDeactivateDto(this.model())),
      );
    } catch (error) {
      this.failure.set(errorCodeOf(error));
      return;
    }
    this.open.set(false);
  }
}

function errorCodeOf(error: unknown): string {
  const body: unknown = error instanceof HttpErrorResponse ? error.error : null;
  const code =
    typeof body === 'object' && body !== null && 'errorCode' in body ? body.errorCode : null;
  return typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN_ERROR';
}
