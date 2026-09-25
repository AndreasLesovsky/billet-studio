import { Component, inject, input, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PASSWORD_MIN_LENGTH } from '../../../core/forms/signal-validators';
import { AuthApi } from '../../../core/services/auth-api';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { PasswordToggle } from '../../../shared/directives/password-toggle';
import { EMPTY_MODEL, ResetPasswordFormModel, resetPasswordSchema } from './reset-password-schema';

/** The target of the reset mail's link, `/reset-password?token=…`. */
@Component({
  selector: 'app-reset-password',
  imports: [FieldError, FormField, PasswordToggle, RouterLink, TranslatePipe],
  templateUrl: './reset-password.html',
  styleUrl: '../auth-page.scss',
})
export class ResetPassword {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);

  /** The `?token=` of the link, bound by the router (it follows the URL while the page is kept). */
  readonly token = input<string>();
  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;

  readonly model = signal<ResetPasswordFormModel>({ ...EMPTY_MODEL });
  readonly resetForm = form(this.model, resetPasswordSchema);

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    const token = this.token();
    if (!token) return;
    if (this.resetForm().invalid()) {
      this.resetForm().markAsTouched();
      return;
    }

    const m = this.model();
    try {
      await this.authApi.resetPassword(token, m.newPassword, m.confirmPassword);
    } catch {
      // errorInterceptor has said why (INVALID_TOKEN / TOKEN_EXPIRED point to a new link).
      return;
    }
    // AuthApi has confirmed it with a toast; signing in is the only thing left to do.
    await this.router.navigateByUrl('/login');
  }
}
