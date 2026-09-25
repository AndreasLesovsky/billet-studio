import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import {
  AccountDto,
  AccountUpdateDto,
  DeactivateAccountRequestDto,
  PasswordChangeDto,
} from '../models/models';
import { AuthApi } from './auth-api';

/**
 * The signed-in user's own account, `/v1/account`. Errors propagate unchanged: errorInterceptor has
 * already shown the toast, so callers catch only when they must react.
 */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);
  private readonly messageStore = inject(MessageStore);
  private readonly authApi = inject(AuthApi);
  private readonly api = `${baseUrl}account`;

  private readonly loaded = signal<AccountDto | null>(null);

  /**
   * The last loaded account, and only while it belongs to whoever is signed in - after a logout or
   * a login as someone else it reads null instead of showing the previous person's data.
   */
  readonly account = computed(() => {
    const account = this.loaded();
    return account !== null && account.id === this.authApi.user()?.id ? account : null;
  });

  async get(): Promise<AccountDto> {
    const account = await firstValueFrom(this.http.get<AccountDto>(this.api));
    this.loaded.set(account);
    return account;
  }

  async update(dto: AccountUpdateDto): Promise<AccountDto> {
    const account = await firstValueFrom(this.http.put<AccountDto>(this.api, dto));
    this.loaded.set(account);
    this.authApi.patchName(account.name);
    this.messageStore.addMessage('success', 'ACCOUNT_UPDATED');
    return account;
  }

  async changePassword(dto: PasswordChangeDto): Promise<void> {
    // Inside the rotation window: the change ends every session of the account server-side and
    // hands this device a replacement cookie in the same response. A renewal that leaves on the
    // same click would travel with the cookie being replaced and read its 401 as an expiry.
    await this.authApi.rotateCredential(() =>
      firstValueFrom(this.http.post<void>(`${this.api}/change-password`, dto)),
    );
    this.messageStore.addMessage('success', 'PASSWORD_CHANGED');
  }

  /**
   * Deactivates the account and ends the session here too: the server has already ended every
   * session of the account, so nothing on this tab may keep acting as if it were signed in.
   */
  async deactivate(dto: DeactivateAccountRequestDto): Promise<void> {
    await firstValueFrom(this.http.post<void>(`${this.api}/deactivate`, dto));
    this.loaded.set(null);
    this.messageStore.addMessage('success', 'ACCOUNT_DEACTIVATED');
    this.authApi.endSession({ reason: 'deactivated' });
  }

  async uploadAvatar(file: File): Promise<AccountDto> {
    const body = new FormData();
    body.append('image', file);
    const account = await firstValueFrom(this.http.post<AccountDto>(`${this.api}/avatar`, body));
    this.loaded.set(account);
    this.authApi.patchAvatar(account.avatarUrl);
    this.messageStore.addMessage('success', 'AVATAR_UPDATED');
    return account;
  }

  async removeAvatar(): Promise<AccountDto> {
    const account = await firstValueFrom(this.http.delete<AccountDto>(`${this.api}/avatar`));
    this.loaded.set(account);
    this.authApi.patchAvatar(null);
    this.messageStore.addMessage('success', 'AVATAR_REMOVED');
    return account;
  }
}
