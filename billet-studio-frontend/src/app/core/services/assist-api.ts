import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { baseUrl } from '../environments/environment';
import { SKIP_ERROR_TOAST, SKIP_LOADING } from '../interceptors/http-context-tokens';
import { AssistReply, AssistRequest, AssistStatus, AssistStatusDto } from '../models/models';

/**
 * The billet assistant, `/v1/assist` (public, docs/assist.md). Nothing here toasts or drives the
 * global bar: the assistant shows its own state - the status line, the "thinking" message and a
 * failed message's error under it (CLAUDE.md "Assist").
 */
@Injectable({ providedIn: 'root' })
export class AssistApi {
  private readonly http = inject(HttpClient);
  private readonly api = `${baseUrl}assist`;

  private quiet(): HttpContext {
    return new HttpContext().set(SKIP_ERROR_TOAST, true).set(SKIP_LOADING, true);
  }

  /** Whether the assistant can answer; never loads the model. */
  async status(): Promise<AssistStatus> {
    const { status } = await firstValueFrom(
      this.http.get<AssistStatusDto>(`${this.api}/status`, { context: this.quiet() }),
    );
    return status;
  }

  /** Starts loading the model, for a user about to ask; its outcome shows in the next status. */
  warmUp(): void {
    this.http.post<void>(`${this.api}/warm-up`, null, { context: this.quiet() }).subscribe({
      error: () => undefined,
    });
  }

  ask(request: AssistRequest): Promise<AssistReply> {
    return firstValueFrom(
      this.http.post<AssistReply>(this.api, request, { context: this.quiet() }),
    );
  }
}
