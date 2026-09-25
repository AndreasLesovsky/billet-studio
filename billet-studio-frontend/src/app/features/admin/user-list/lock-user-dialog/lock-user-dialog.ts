import { Component, inject, linkedSignal, model, output, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { ADMIN_DEACTIVATION_REASONS, UserResponseDto } from '../../../../core/models/models';
import { AdminUserApi } from '../../../../core/services/admin-user-api';
import { runPending } from '../../../../core/utils/pending';
import { Modal } from '../../../../shared/directives/modal';
import { EMPTY_MODEL, LockUserFormModel, toLockReason } from './lock-user-dialog-schema';

/**
 * Locks an account and records why, in one step, so a reason never exists without the lock that
 * produced it. Unlocking needs no reason and goes through the plain confirmation dialog.
 */
@Component({
  selector: 'app-lock-user-dialog',
  imports: [FormField, Modal, TranslatePipe],
  templateUrl: './lock-user-dialog.html',
})
export class LockUserDialog {
  private readonly adminUserApi = inject(AdminUserApi);

  /** The account to lock. Open while set; the dialog clears it when it closes. */
  readonly user = model<UserResponseDto | null>(null);

  /** The lock went through. */
  readonly locked = output<void>();

  protected readonly reasons = ADMIN_DEACTIVATION_REASONS;
  /** The lock request runs: nothing closes the dialog meanwhile. */
  readonly locking = signal(false);

  /** The name stays in the text while the dialog fades out, after `user` is already cleared. */
  protected readonly shownName = linkedSignal<UserResponseDto | null, string>({
    source: this.user,
    computation: (user, previous) => user?.name ?? previous?.value ?? '',
  });

  readonly model = signal<LockUserFormModel>({ ...EMPTY_MODEL });
  readonly lockForm = form(this.model);

  cancel(): void {
    if (this.locking()) return;
    this.user.set(null);
  }

  onClosed(): void {
    this.lockForm().reset({ ...EMPTY_MODEL });
  }

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    const user = this.user();
    if (!user) return;

    try {
      await runPending(this.locking, () =>
        this.adminUserApi.toggleActive(user.id, toLockReason(this.model())),
      );
    } catch {
      // errorInterceptor has said why; the dialog stays for another try or a cancel.
      return;
    }
    this.user.set(null);
    this.locked.emit();
  }
}
