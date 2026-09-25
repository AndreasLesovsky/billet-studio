import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { DeactivationReason, PageDto, UserRequestDto, UserResponseDto } from '../models/models';
import { AuthApi } from './auth-api';

export type UserSortField = 'name' | 'email' | 'createdAt' | 'role';
export type SortDirection = 'asc' | 'desc';

/** One page of the admin user table. `q` matches name or email; `active` null = both states. */
export interface UserListQuery {
  page: number;
  size: number;
  q: string;
  active: boolean | null;
  sort: UserSortField;
  direction: SortDirection;
}

/** The admin user management, `/v1/users` (ROLE_ADMIN). Errors propagate unchanged. */
@Injectable({ providedIn: 'root' })
export class AdminUserApi {
  private readonly http = inject(HttpClient);
  private readonly messageStore = inject(MessageStore);
  private readonly authApi = inject(AuthApi);
  private readonly api = `${baseUrl}users`;

  readonly roles = signal<string[]>([]);

  async list(query: UserListQuery): Promise<PageDto<UserResponseDto>> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('size', query.size)
      .set('sort', `${query.sort},${query.direction}`);
    const q = query.q.trim();
    if (q) params = params.set('q', q);
    if (query.active !== null) params = params.set('active', query.active);
    return firstValueFrom(this.http.get<PageDto<UserResponseDto>>(this.api, { params }));
  }

  async loadRoles(): Promise<string[]> {
    const roles = await firstValueFrom(this.http.get<string[]>(`${this.api}/roles`));
    this.roles.set(roles);
    return roles;
  }

  async get(id: number): Promise<UserResponseDto> {
    return firstValueFrom(this.http.get<UserResponseDto>(`${this.api}/${id}`));
  }

  async create(dto: UserRequestDto): Promise<UserResponseDto> {
    const created = await firstValueFrom(this.http.post<UserResponseDto>(this.api, dto));
    this.messageStore.addMessage('success', 'USER_CREATED');
    return created;
  }

  /**
   * An admin who changes their OWN password rotates this device's refresh cookie: the server ends
   * every session of the account and answers with a replacement, the same way the account page
   * does. So the rotation window opens on exactly the requests that rotate.
   */
  async update(id: number, dto: UserRequestDto): Promise<UserResponseDto> {
    const send = (): Promise<UserResponseDto> =>
      firstValueFrom(this.http.put<UserResponseDto>(`${this.api}/${id}`, dto));
    const rotatesThisDevice = dto.password !== '' && id === this.authApi.user()?.id;

    const updated = await (rotatesThisDevice ? this.authApi.rotateCredential(send) : send());
    this.messageStore.addMessage('success', 'USER_UPDATED');
    return updated;
  }

  /** Flips the active flag; the reason is only read when the account gets locked. */
  async toggleActive(id: number, reason: DeactivationReason | null): Promise<UserResponseDto> {
    const updated = await firstValueFrom(
      this.http.patch<UserResponseDto>(`${this.api}/${id}/active`, { reason }),
    );
    this.messageStore.addMessage('success', updated.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED');
    return updated;
  }

  async delete(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.api}/${id}`));
    this.messageStore.addMessage('success', 'USER_DELETED');
  }
}
