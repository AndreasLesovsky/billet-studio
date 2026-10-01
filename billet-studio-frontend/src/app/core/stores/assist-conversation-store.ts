import { computed, inject, Injectable, signal } from '@angular/core';

import type { AssistBilletDto, AssistTurnDto } from '../models/models';
import { AssistApi } from '../services/assist-api';
import { AuthApi } from '../services/auth-api';
import { apiErrorCode, isUnreachable } from '../utils/api-error';

/** Turns the backend reads per question (AssistRequest, 1..10). */
const MAX_TURNS = 10;

/** A message the user sent; `failedCode` (MESSAGES.ERROR.<code>) when no answer came. */
interface AssistUserEntry {
  readonly kind: 'user';
  readonly id: number;
  readonly text: string;
  readonly failedCode: string | null;
}

/** The assistant's answer: a billet to start (null when the message changed nothing) and notes. */
interface AssistReplyEntry {
  readonly kind: 'reply';
  readonly id: number;
  readonly billet: AssistBilletDto | null;
  /** ASSIST.NOTES.<code> */
  readonly notes: readonly string[];
}

type AssistEntry = AssistUserEntry | AssistReplyEntry;

/** Notes after which the reply offers no billet: the message did not change the one before. */
const NO_BILLET_NOTES = ['OFF_TOPIC', 'NO_CHANGE'];

/**
 * The billet assistant's chat, shared by the home page and the template gallery for the session.
 * It belongs to whoever wrote it: after a sign-in, sign-out or another account it reads as empty.
 * Only text the user typed and the labels the backend answered are kept, never any model text.
 */
@Injectable({ providedIn: 'root' })
export class AssistConversationStore {
  private readonly api = inject(AssistApi);
  private readonly auth = inject(AuthApi);
  private readonly userId = computed(() => this.auth.user()?.id ?? null);

  private readonly chat = signal<{ owner: number | null; entries: readonly AssistEntry[] }>({
    owner: null,
    entries: [],
  });
  private nextId = 0;

  readonly entries = computed(() =>
    this.chat().owner === this.userId() ? this.chat().entries : [],
  );
  readonly asking = signal(false);

  /** Sends a message; the answer (or the reason there is none) lands in `entries`. */
  async send(text: string): Promise<void> {
    const message = clean(text);
    if (!message || this.asking()) return;
    const entry: AssistUserEntry = {
      kind: 'user',
      id: this.nextId++,
      text: message,
      failedCode: null,
    };
    const history = this.entries();
    this.chat.set({ owner: this.userId(), entries: [...history, entry] });

    this.asking.set(true);
    try {
      const reply = await this.api.ask({ conversation: [...turnsOf(history), turnOf(entry)] });
      const offers = !reply.notes.some((note) => NO_BILLET_NOTES.includes(note));
      this.append({
        kind: 'reply',
        id: this.nextId++,
        billet: offers ? reply.billet : null,
        notes: reply.notes,
      });
    } catch (error) {
      const code = isUnreachable(error)
        ? 'SERVER_UNREACHABLE'
        : (apiErrorCode(error) ?? 'UNKNOWN_ERROR');
      this.update(entry.id, { ...entry, failedCode: code });
    } finally {
      this.asking.set(false);
    }
  }

  /** Sends a failed message again, as the newest one. */
  async retry(id: number): Promise<void> {
    const failed = this.entries().find((entry) => entry.id === id);
    if (failed?.kind !== 'user' || failed.failedCode === null || this.asking()) return;
    this.chat.update((chat) => ({
      ...chat,
      entries: chat.entries.filter((entry) => entry.id !== id),
    }));
    await this.send(failed.text);
  }

  restart(): void {
    this.chat.set({ owner: this.userId(), entries: [] });
  }

  private append(entry: AssistEntry): void {
    this.chat.update((chat) => ({ ...chat, entries: [...chat.entries, entry] }));
  }

  private update(id: number, entry: AssistEntry): void {
    this.chat.update((chat) => ({
      ...chat,
      entries: chat.entries.map((current) => (current.id === id ? entry : current)),
    }));
  }
}

/** Line breaks as \n; tabs and other control characters, which the backend refuses, as spaces. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim();
}

/**
 * What the backend reads of the chat so far: the answered messages and the billets offered, the
 * newest ones. The last offer always stays in: the backend changes that billet, and without it
 * would start from the blank one.
 */
function turnsOf(entries: readonly AssistEntry[]): AssistTurnDto[] {
  const turns = entries.flatMap((entry): AssistTurnDto[] => {
    if (entry.kind === 'user') return entry.failedCode === null ? [turnOf(entry)] : [];
    return entry.billet ? [{ role: 'assistant', content: null, billet: entry.billet }] : [];
  });
  const recent = turns.slice(-(MAX_TURNS - 1));
  const lastOffer = turns.filter((turn) => turn.role === 'assistant').at(-1);
  return lastOffer && !recent.includes(lastOffer)
    ? [lastOffer, ...recent.slice(-(MAX_TURNS - 2))]
    : recent;
}

function turnOf(entry: AssistUserEntry): AssistTurnDto {
  return { role: 'user', content: entry.text, billet: null };
}
