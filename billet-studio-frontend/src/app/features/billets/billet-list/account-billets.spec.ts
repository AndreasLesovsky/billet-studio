import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createMockAuthApi, createMockMessageStore } from '../../../../test-helpers';
import { AuthApi } from '../../../core/services/auth-api';
import { BilletApi } from '../../../core/services/billet-api';
import { MessageStore } from '../../../core/stores/message-store';
import { AccountBillets } from './account-billets';

describe('AccountBillets', () => {
  it('an action whose request got no answer says so; a refusal is left to errorInterceptor', async () => {
    const remove = vi.fn<(id: number) => Promise<void>>();
    const messages = createMockMessageStore();
    TestBed.configureTestingModule({
      providers: [
        AccountBillets,
        // No user: the list never loads.
        { provide: AuthApi, useValue: createMockAuthApi() },
        { provide: BilletApi, useValue: { remove } },
        { provide: MessageStore, useValue: messages },
      ],
    });
    const account = TestBed.inject(AccountBillets);

    const offline = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    remove.mockRejectedValueOnce(offline);
    await expect(account.remove(1)).rejects.toBe(offline);
    expect(messages.addMessage).toHaveBeenCalledExactlyOnceWith('error', 'SERVER_UNREACHABLE');

    const refused = new HttpErrorResponse({
      status: 500,
      error: { errorCode: 'INTERNAL_SERVER_ERROR', status: 500 },
    });
    remove.mockRejectedValueOnce(refused);
    await expect(account.remove(1)).rejects.toBe(refused);
    expect(messages.addMessage).toHaveBeenCalledOnce();
  });
});
