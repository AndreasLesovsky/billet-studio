import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apply, disabled, form, FormField, required } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { createModelUndo } from '../../../core/forms/model-undo';
import { PASSWORD_MIN_LENGTH } from '../../../core/forms/signal-validators';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes-guard';
import { isLoading } from '../../../core/interceptors/loading-interceptor';
import { ADMIN_DEACTIVATION_REASONS, UserResponseDto } from '../../../core/models/models';
import { AdminUserApi } from '../../../core/services/admin-user-api';
import { AuthApi } from '../../../core/services/auth-api';
import { LanguageService } from '../../../core/services/language-service';
import { BreadcrumbService } from '../../../shared/components/breadcrumb/breadcrumb-service';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { PasswordToggle } from '../../../shared/directives/password-toggle';
import {
  EMPTY_MODEL,
  toUserFormModel,
  toUserRequestDto,
  UserFormModel,
  userSchema,
} from './user-form-schema';

const LIST_ROUTE = '/admin/users';

/** Creates an account (`/admin/users/new`) or edits one (`/admin/users/:id`). */
@Component({
  selector: 'app-user-form',
  imports: [FieldError, FormField, PasswordToggle, RouterLink, TranslatePipe],
  templateUrl: './user-form.html',
  styleUrl: './user-form.scss',
})
export class UserForm implements HasUnsavedChanges {
  private readonly adminUserApi = inject(AdminUserApi);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly languageService = inject(LanguageService);

  protected readonly loading = isLoading;
  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  protected readonly languages = this.languageService.availableLanguages;
  protected readonly reasons = ADMIN_DEACTIVATION_REASONS;
  protected readonly roles = this.adminUserApi.roles;

  private readonly route = inject(ActivatedRoute);

  /** The `:id` of the account being edited; null on `/admin/users/new`. */
  private readonly idParam = signal(this.route.snapshot.paramMap.get('id'));
  readonly isEditMode = this.idParam() !== null;

  protected readonly titleKey = this.isEditMode
    ? 'ADMIN_USERS.EDIT_TITLE'
    : 'ADMIN_USERS.CREATE_TITLE';
  protected readonly submitKey = this.isEditMode ? 'COMMON.SAVE' : 'ADMIN_USERS.CREATE';
  protected readonly submitIcon = this.isEditMode ? 'bi-check-lg' : 'bi-person-plus';

  /** The selects need their options before they can show a value, so the form waits for both. */
  readonly ready = signal(false);

  /** Locking yourself out is not offered (the backend refuses it too). */
  readonly editingSelf = computed(
    () => this.isEditMode && String(this.authApi.user()?.id) === this.idParam(),
  );
  protected readonly activeHintKey = computed(() =>
    this.editingSelf() ? 'ADMIN_USERS.ACTIVE_SELF_HINT' : 'ADMIN_USERS.ACTIVE_HINT',
  );

  readonly model = signal<UserFormModel>({
    ...EMPTY_MODEL,
    preferredLanguage: this.languageService.currentLang(),
  });

  // Both rules read component state: a password is needed to create an account, while an empty one
  // keeps the current password when editing; and nobody switches their own account off.
  readonly userForm = form(this.model, (p) => {
    apply(p, userSchema);
    required(p.password, {
      message: 'ADMIN_USERS.PASSWORD_REQUIRED',
      when: () => !this.isEditMode,
    });
    disabled(p.active, { when: () => this.editingSelf() });
  });

  private readonly undoCtl = createModelUndo(this.model);
  readonly canUndo = this.undoCtl.canUndo;

  protected readonly canSave = computed(
    () => this.userForm().valid() && this.canUndo() && !this.loading(),
  );

  constructor() {
    this.undoCtl.saveSnapshot();
    // The router keeps this page when only the id changes (/admin/users/5 to /6, by history or a
    // link), so every id that arrives is loaded, not only the first.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.idParam.set(params.get('id'));
      void this.load();
    });
  }

  undo(): void {
    this.undoCtl.undo();
  }

  async onSubmit(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.userForm().invalid() || !this.canUndo()) {
      this.userForm().markAsTouched();
      return;
    }

    const dto = toUserRequestDto(this.model());
    try {
      if (this.isEditMode) {
        const updated = await this.adminUserApi.update(Number(this.idParam()), dto);
        if (this.editingSelf()) this.authApi.patchName(updated.name);
      } else {
        await this.adminUserApi.create(dto);
      }
    } catch {
      // errorInterceptor has said why (e.g. EMAIL_ALREADY_EXISTS); the form stays as typed.
      return;
    }
    // Saved, so nothing is unsaved: the guard lets the page go without asking.
    this.undoCtl.saveSnapshot();
    await this.router.navigateByUrl(LIST_ROUTE);
  }

  private async load(): Promise<void> {
    const idParam = this.idParam();
    this.ready.set(false);
    let user: UserResponseDto | null;
    try {
      [, user] = await Promise.all([this.adminUserApi.loadRoles(), this.fetchUser(idParam)]);
    } catch {
      // errorInterceptor has said why (USER_NOT_FOUND, ...); there is nothing here to edit.
      if (idParam === this.idParam()) await this.router.navigateByUrl(LIST_ROUTE);
      return;
    }
    // Another id arrived meanwhile; its own load answers for the page.
    if (idParam !== this.idParam()) return;

    if (user) {
      // The root account is managed by the environment; its editor is never opened, not even by URL.
      if (user.protectedAccount) {
        await this.router.navigateByUrl(LIST_ROUTE);
        return;
      }
      this.model.set(toUserFormModel(user));
      this.undoCtl.saveSnapshot();
      this.breadcrumb.setDynamicLabel(user.name);
    }
    this.ready.set(true);
  }

  private async fetchUser(idParam: string | null): Promise<UserResponseDto | null> {
    if (idParam === null) return null;
    const id = Number(idParam);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`No user id: ${idParam}`);
    return this.adminUserApi.get(id);
  }
}
