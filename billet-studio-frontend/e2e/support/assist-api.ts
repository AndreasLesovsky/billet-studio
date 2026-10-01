import type { Page } from '@playwright/test';

import { apiError, CORS_HEADERS } from './guest-api';

/** AssistBilletDto (docs/api-contract.md): a start configuration as questionnaire labels. */
export interface AssistBillet {
  readonly template: string;
  readonly theme: string;
  readonly particles: string;
  readonly divider: string;
  readonly colorMode: string;
  readonly lang: string;
  readonly model: string;
}

/** AssistReply; null answers the question with 503 ASSIST_UNAVAILABLE. */
export type AssistAnswer = { readonly billet: AssistBillet; readonly notes: string[] } | null;

interface AssistTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string | null;
  readonly billet: AssistBillet | null;
}

/**
 * Stands in for the billet assistant (/v1/assist): the given status, a warm-up that is accepted,
 * and the answers in order, one per question. Install after mockGuestApi or AccountBackend: the
 * newest route answers first. `conversations` collects what each question sent.
 */
export async function mockAssistant(
  page: Page,
  status: 'READY' | 'IDLE' | 'OFFLINE',
  answers: readonly AssistAnswer[] = [],
): Promise<{ conversations: AssistTurn[][] }> {
  const conversations: AssistTurn[][] = [];
  await page.route('**/v1/assist**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/v1/assist/status') {
      await route.fulfill({ json: { status }, headers: CORS_HEADERS });
    } else if (path === '/v1/assist/warm-up') {
      await route.fulfill({ status: 202, headers: CORS_HEADERS });
    } else {
      const body = request.postDataJSON() as { conversation: AssistTurn[] };
      const answer = answers[conversations.length] ?? null;
      conversations.push(body.conversation);
      await route.fulfill(
        answer
          ? { json: answer, headers: CORS_HEADERS }
          : { status: 503, json: apiError('ASSIST_UNAVAILABLE', 503), headers: CORS_HEADERS },
      );
    }
  });
  return { conversations };
}
