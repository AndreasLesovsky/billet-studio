import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import { keepUnsavedWork } from '../../core/forms/keep-unsaved-work';
import { createModelUndo } from '../../core/forms/model-undo';
import { PASSWORD_MIN_LENGTH } from '../../core/forms/signal-validators';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes-guard';
import { isLoading } from '../../core/interceptors/loading-interceptor';
import { AccountDto, PasswordChangeDto } from '../../core/models/models';
import { AccountApi } from '../../core/services/account-api';
import { isLanguage, LanguageService } from '../../core/services/language-service';
import { DeactivateAccountModal } from '../../shared/components/deactivate-account-modal/deactivate-account-modal';
import { FieldError } from '../../shared/components/field-error/field-error';
import { PasswordToggle } from '../../shared/directives/password-toggle';
import { AccountAvatar } from './account-avatar/account-avatar';
import {
  EMPTY_PASSWORD_MODEL,
  EMPTY_PROFILE_MODEL,
  passwordChangeSchema,
  ProfileFormModel,
  profileSchema,
  toProfileModel,
} from './account-schema';

/**
 * The signed-in user's own account: profile (name, language), picture, password, deactivation.
 * The two forms and the picture are independent; each saves on its own.
 */
@Component({
  selector: 'app-account',
  imports: [
    AccountAvatar,
    DatePipe,
    DeactivateAccountModal,
    FieldError,
    FormField,
    PasswordToggle,
    TranslatePipe,
  ],
  templateUrl: './account.html',
  styleUrl: './account.scss',
  host: {
    '(window:dragover)': 'refuseStrayFileDrop($event)',
    '(window:drop)': 'refuseStrayFileDrop($event)',
  },
})
export class Account implements HasUnsavedChanges {
  private readonly accountApi = inject(AccountApi);
  private readonly languageService = inject(LanguageService);

  protected readonly account = this.accountApi.account;
  protected readonly loading = isLoading;
  protected readonly locale = this.languageService.locale;
  protected readonly languages = this.languageService.availableLanguages;
  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;

  readonly profileModel = signal<ProfileFormModel>({ ...EMPTY_PROFILE_MODEL });
  readonly profileForm = form(this.profileModel, profileSchema);
  private readonly profileUndo = createModelUndo(this.profileModel);
  readonly profileChanged = this.profileUndo.canUndo;

  readonly passwordModel = signal<PasswordChangeDto>({ ...EMPTY_PASSWORD_MODEL });
  readonly passwordForm = form(this.passwordModel, passwordChangeSchema);
  private readonly passwordUndo = createModelUndo(this.passwordModel);

  protected readonly canSaveProfile = computed(
    () => this.profileForm().valid() && this.profileChanged() && !this.loading(),
  );
  protected readonly canChangePassword = computed(
    () => this.passwordForm().valid() && !this.loading(),
  );

  private readonly avatar = viewChild(AccountAvatar);

  readonly deactivateOpen = signal(false);

  /** Read by unsavedChangesGuard: anything typed or picked here that is not saved yet. */
  readonly canUndo = computed(
    () =>
      this.profileChanged() || this.passwordUndo.canUndo() || this.avatar()?.hasStaged() === true,
  );

  // Only the profile is carried across a logout: passwords never outlive the page, and a file
  // would need a new pick anyway.
  private readonly keptWork = keepUnsavedWork('account', {
    isDirty: () => this.profileChanged(),
    capture: () => this.profileModel(),
  });

  constructor() {
    this.profileUndo.saveSnapshot();
    this.passwordUndo.saveSnapshot();
    void this.load();
  }

  private async load(): Promise<void> {
    const cached = this.account();
    if (cached) this.seedProfile(cached);

    try {
      const fresh = await this.accountApi.get();
      // Typing may have begun on the cached copy; that edit wins over the refresh.
      if (!this.profileChanged()) this.seedProfile(fresh);
    } catch {
      return;
    }
    await this.keptWork.offerKept<ProfileFormModel>((kept) => this.profileModel.set(kept));
  }

  private seedProfile(account: AccountDto): void {
    this.profileModel.set(toProfileModel(account));
    this.profileUndo.saveSnapshot();
  }

  undoProfile(): void {
    this.profileUndo.undo();
  }

  /**
   * A file dropped beside the avatar card would be opened by the browser in this tab, and the page
   * would go with everything unsaved. The card accepts its own drops first (defaultPrevented);
   * every other file drag is refused while this page is shown.
   */
  protected refuseStrayFileDrop(event: DragEvent): void {
    if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  }

  async onProfileSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.profileForm().invalid() || !this.profileChanged()) {
      this.profileForm().markAsTouched();
      return;
    }

    let saved: AccountDto;
    try {
      saved = await this.accountApi.update(this.profileModel());
    } catch {
      return;
    }
    this.seedProfile(saved);
    // The saved preference is the account's language, so the interface follows it right away.
    const language = saved.preferredLanguage;
    if (isLanguage(language) && language !== this.languageService.currentLang()) {
      this.languageService.setLanguage(language);
    }
  }

  async onPasswordSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.passwordForm().invalid()) {
      this.passwordForm().markAsTouched();
      return;
    }

    try {
      await this.accountApi.changePassword(this.passwordModel());
    } catch {
      return;
    }
    this.passwordForm().reset({ ...EMPTY_PASSWORD_MODEL });
  }
}
