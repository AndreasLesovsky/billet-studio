import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthApi } from '../../../core/services/auth-api';
import { runPending } from '../../../core/utils/pending';
import { FieldError } from '../../../shared/components/field-error/field-error';
import {
  EMPTY_MODEL,
  ForgotPasswordFormModel,
  forgotPasswordSchema,
} from './forgot-password-schema';

@Component({
  selector: 'app-forgot-password',
  imports: [FieldError, FormField, RouterLink, TranslatePipe],
  templateUrl: './forgot-password.html',
  styleUrl: '../auth-page.scss',
})
export class ForgotPassword {
  private readonly authApi = inject(AuthApi);
  private readonly injector = inject(Injector);
  private readonly doneHeading = viewChild<ElementRef<HTMLElement>>('doneHeading');

  readonly model = signal<ForgotPasswordFormModel>({ ...EMPTY_MODEL });
  readonly forgotForm = form(this.model, forgotPasswordSchema);

  readonly submitted = signal(false);
  readonly sending = signal(false);

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.forgotForm().invalid()) {
      this.forgotForm().markAsTouched();
      return;
    }

    try {
      await runPending(this.sending, () => this.authApi.forgotPassword(this.model().email));
    } catch {
      // errorInterceptor has said why.
    }
    // The same answer whether or not the address has an account: nothing here may tell them apart.
    this.submitted.set(true);
    // The form (and the focused button) is gone; the confirmation takes the focus.
    afterNextRender(() => this.doneHeading()?.nativeElement.focus(), { injector: this.injector });
  }
}
