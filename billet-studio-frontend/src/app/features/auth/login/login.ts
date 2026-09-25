import { Component, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { UserWithTokenDto } from '../../../core/models/userWithTokenDto';
import { AuthApi } from '../../../core/services/auth-api';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { PasswordToggle } from '../../../shared/directives/password-toggle';
import { postLoginTarget } from '../post-login';
import { EMPTY_MODEL, LoginFormModel, loginSchema } from './login-schema';

@Component({
  selector: 'app-login',
  imports: [FieldError, FormField, PasswordToggle, RouterLink, TranslatePipe],
  templateUrl: './login.html',
  styleUrl: '../auth-page.scss',
})
export class Login {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly model = signal<LoginFormModel>({ ...EMPTY_MODEL });
  readonly loginForm = form(this.model, loginSchema);

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.loginForm().invalid()) {
      this.loginForm().markAsTouched();
      return;
    }

    let user: UserWithTokenDto | null;
    try {
      user = await this.authApi.login(this.model());
    } catch {
      // errorInterceptor has said why; the form stays as typed.
      return;
    }
    if (!user) return;

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    await this.router.navigateByUrl(postLoginTarget(returnUrl, this.authApi, user.id));
  }
}
