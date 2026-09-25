import { Component, inject, linkedSignal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PASSWORD_MIN_LENGTH } from '../../../core/forms/signal-validators';
import { isLoading } from '../../../core/interceptors/loading-interceptor';
import { UserWithTokenDto } from '../../../core/models/userWithTokenDto';
import { AuthApi } from '../../../core/services/auth-api';
import { isLanguage, Language, LanguageService } from '../../../core/services/language-service';
import { UserApi } from '../../../core/services/user-api';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { PasswordToggle } from '../../../shared/directives/password-toggle';
import { postLoginTarget } from '../post-login';
import {
  RegisterFormModel,
  registerSchema,
  toRegisterDto,
  withUiLanguage,
} from './register-schema';

@Component({
  selector: 'app-register',
  imports: [FieldError, FormField, PasswordToggle, RouterLink, TranslatePipe],
  templateUrl: './register.html',
  styleUrl: '../auth-page.scss',
})
export class Register {
  private readonly userApi = inject(UserApi);
  private readonly authApi = inject(AuthApi);
  private readonly languageService = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = isLoading;
  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  protected readonly languages = this.languageService.availableLanguages;

  readonly model = linkedSignal<Language, RegisterFormModel>({
    source: this.languageService.currentLang,
    computation: withUiLanguage,
  });
  readonly registerForm = form(this.model, registerSchema);

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.registerForm().invalid()) {
      this.registerForm().markAsTouched();
      return;
    }

    const m = this.model();
    try {
      await this.userApi.register(toRegisterDto(m));
    } catch {
      // errorInterceptor has said why (e.g. EMAIL_ALREADY_EXISTS); nothing was created.
      return;
    }

    // Signing up does not sign in: the same credentials do, and the login's redirect rule applies.
    let user: UserWithTokenDto | null = null;
    try {
      user = await this.authApi.login({ email: m.email, password: m.password });
    } catch {
      // The account exists; only the automatic sign-in failed, so the login page takes over.
    }

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!user) {
      await this.router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : {} });
      return;
    }
    // The account's language is the one just chosen; the interface follows it from here on.
    const language = m.preferredLanguage;
    if (isLanguage(language) && language !== this.languageService.currentLang()) {
      this.languageService.setLanguage(language);
    }
    await this.router.navigateByUrl(postLoginTarget(returnUrl, this.authApi, user.id));
  }
}
