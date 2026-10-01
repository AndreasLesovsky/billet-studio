import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { AssistStatus } from '../../../core/models/models';
import { AssetCatalogApi } from '../../../core/services/asset-catalog-api';
import { AssistApi } from '../../../core/services/assist-api';
import { AssistConversationStore } from '../../../core/stores/assist-conversation-store';
import { translateTestingModule } from '../../../../test-helpers';
import { BilletAssistant } from './billet-assistant';

/** The status answers in order; an Error rejects. The last one repeats. */
async function setup(...statuses: (AssistStatus | Error)[]) {
  let calls = 0;
  const api = {
    status: vi.fn(async () => {
      const next = statuses[Math.min(calls++, statuses.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    }),
    warmUp: vi.fn(),
  };
  const conversation = {
    entries: signal([]),
    asking: signal(false),
    send: vi.fn(async () => undefined),
    restart: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [BilletAssistant, translateTestingModule()],
    providers: [
      { provide: AssistApi, useValue: api },
      { provide: AssistConversationStore, useValue: conversation },
      { provide: AssetCatalogApi, useValue: { list: vi.fn(async () => []) } },
    ],
  });
  TestBed.overrideComponent(BilletAssistant, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(BilletAssistant);
  await vi.waitFor(() => expect(api.status).toHaveBeenCalled());
  await fixture.whenStable();
  const component = fixture.componentInstance as BilletAssistant & {
    onFocus(): void;
    shown(): boolean;
  };
  return { component, api, conversation, fixture };
}

describe('BilletAssistant', () => {
  it('sends the message and empties the field', async () => {
    const { component, conversation } = await setup('READY');
    component.model.set({ message: 'Eine Geburtstagskarte' });

    await component.onSubmit();

    expect(conversation.send).toHaveBeenCalledWith('Eine Geburtstagskarte');
    expect(component.model().message).toBe('');
  });

  it('sends nothing while the assistant is offline, and keeps what was typed', async () => {
    const { component, conversation } = await setup('OFFLINE');
    component.model.set({ message: 'Eine Geburtstagskarte' });

    await component.onSubmit();

    expect(conversation.send).not.toHaveBeenCalled();
    expect(component.model().message).toBe('Eine Geburtstagskarte');
  });

  it('is not there while switched off or when its status cannot be read', async () => {
    expect((await setup('DISABLED')).component.shown()).toBe(false);
    TestBed.resetTestingModule();
    expect((await setup(new Error('offline'))).component.shown()).toBe(false);
  });

  it('stays, with its chat, when a later status read fails', async () => {
    const { component, api, fixture } = await setup('READY', new Error('offline'));
    component.model.set({ message: 'Eine Geburtstagskarte' });

    await component.onSubmit();
    await vi.waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
    await fixture.whenStable();

    expect(component.shown()).toBe(true);
  });

  it('loads the model when the input is first focused, not on the page visit', async () => {
    const { component, api } = await setup('IDLE');
    expect(api.warmUp).not.toHaveBeenCalled();

    component.onFocus();
    component.onFocus();

    expect(api.warmUp).toHaveBeenCalledTimes(1);
  });
});
