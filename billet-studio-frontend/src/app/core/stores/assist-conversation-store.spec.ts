import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AssistBilletDto, AssistReply, AssistRequest } from '../models/models';
import { AssistApi } from '../services/assist-api';
import { AuthApi } from '../services/auth-api';
import { createMockAuthApi, testUser, type MockAuthApi } from '../../../test-helpers';
import { AssistConversationStore } from './assist-conversation-store';

const BIRTHDAY: AssistBilletDto = {
  template: 'geburtstag',
  theme: 'TEMPLATE_DEFAULT',
  particles: 'TEMPLATE_DEFAULT',
  divider: 'TEMPLATE_DEFAULT',
  colorMode: 'auto',
  lang: 'UI_LANGUAGE',
  model: 'TEMPLATE_DEFAULT',
};

const offer = (billet: AssistBilletDto, notes: string[] = []): AssistReply => ({ billet, notes });

describe('AssistConversationStore', () => {
  let ask: Mock<(request: AssistRequest) => Promise<AssistReply>>;
  let auth: MockAuthApi;
  let store: AssistConversationStore;

  beforeEach(() => {
    ask = vi.fn(async () => offer(BIRTHDAY));
    auth = createMockAuthApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: AssistApi, useValue: { ask } },
        { provide: AuthApi, useValue: auth },
      ],
    });
    store = TestBed.inject(AssistConversationStore);
  });

  const conversationOf = (call: number) => ask.mock.calls[call][0].conversation;

  it('sends the chat so far: answered messages and offered billets, the new message last', async () => {
    await store.send('Eine Geburtstagskarte');
    ask.mockResolvedValueOnce(offer(BIRTHDAY, ['NO_CHANGE']));
    await store.send('danke');
    await store.send('lieber\r\ndunkel\t!');

    expect(conversationOf(2)).toEqual([
      { role: 'user', content: 'Eine Geburtstagskarte', billet: null },
      { role: 'assistant', content: null, billet: BIRTHDAY },
      { role: 'user', content: 'danke', billet: null },
      { role: 'user', content: 'lieber\ndunkel !', billet: null },
    ]);
    expect(store.entries().map((entry) => entry.kind === 'reply' && entry.billet)).toEqual([
      false,
      BIRTHDAY,
      false,
      null,
      false,
      BIRTHDAY,
    ]);
  });

  it('sends at most the last ten turns, and always the billet offered last', async () => {
    for (let i = 0; i < 7; i++) await store.send(`Nachricht ${i}`);

    expect(conversationOf(6)).toHaveLength(10);
    expect(conversationOf(6).at(-1)).toEqual({
      role: 'user',
      content: 'Nachricht 6',
      billet: null,
    });

    ask.mockResolvedValue(offer(BIRTHDAY, ['NO_CHANGE']));
    for (let i = 7; i < 17; i++) await store.send(`danke ${i}`);

    expect(conversationOf(16)).toHaveLength(10);
    expect(conversationOf(16)[0]).toEqual({ role: 'assistant', content: null, billet: BIRTHDAY });
  });

  it('keeps a failed message visible with its reason, leaves it out of the next question, and retries it', async () => {
    ask.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.send('Weihnachten');
    ask.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 503, error: { errorCode: 'ASSIST_UNAVAILABLE' } }),
    );
    await store.send('mit Schnee');

    expect(store.entries()).toMatchObject([
      { kind: 'user', text: 'Weihnachten', failedCode: 'SERVER_UNREACHABLE' },
      { kind: 'user', text: 'mit Schnee', failedCode: 'ASSIST_UNAVAILABLE' },
    ]);
    expect(conversationOf(1)).toEqual([{ role: 'user', content: 'mit Schnee', billet: null }]);

    await store.retry(store.entries()[0].id);

    expect(conversationOf(2)).toEqual([{ role: 'user', content: 'Weihnachten', billet: null }]);
    expect(store.entries()).toMatchObject([
      { kind: 'user', text: 'mit Schnee', failedCode: 'ASSIST_UNAVAILABLE' },
      { kind: 'user', text: 'Weihnachten', failedCode: null },
      { kind: 'reply', billet: BIRTHDAY },
    ]);
  });

  it('belongs to whoever wrote it: another account or a sign-out sees an empty chat', async () => {
    await store.send('Eine Geburtstagskarte');
    expect(store.entries()).toHaveLength(2);

    auth.user.set(testUser({ id: 7 }));
    expect(store.entries()).toEqual([]);

    await store.send('Hochzeit');
    expect(conversationOf(1)).toEqual([{ role: 'user', content: 'Hochzeit', billet: null }]);

    auth.user.set(null);
    expect(store.entries()).toEqual([]);
  });
});
