import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { MessageStore } from '../stores/message-store';
import { baseUrl } from '../environments/environment';
import { RegisterRequestDto, UserResponseDto } from '../models/models';

/** Public sign-up. Registering does not log in: the caller logs in with the same credentials. */
@Injectable({ providedIn: 'root' })
export class UserApi {
  private readonly http = inject(HttpClient);
  private readonly messageStore = inject(MessageStore);

  async register(dto: RegisterRequestDto): Promise<UserResponseDto> {
    const created = await firstValueFrom(
      this.http.post<UserResponseDto>(`${baseUrl}auth/register`, dto),
    );
    this.messageStore.addMessage('success', 'REGISTRATION_SUCCESS');
    return created;
  }
}
