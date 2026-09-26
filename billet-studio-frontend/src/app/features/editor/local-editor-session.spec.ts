import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createDocument, type BilletDocument } from '../../billet/billet-document';
import type { BilletDetailDto } from '../../core/models/models';
import { AuthApi } from '../../core/services/auth-api';
import { BilletApi } from '../../core/services/billet-api';
import { LocalBilletStore } from '../../core/services/local-billet-store';
import {
  createMockActivatedRoute,
  createMockAuthApi,
  createMockRouter,
  testUser,
  translateTestingModule,
  type MockRouter,
} from '../../../test-helpers';
import { readBackup } from './billet-backup';
import { LocalEditorSession } from './local-editor-session';

describe('LocalEditorSession', () => {
  let store: LocalBilletStore;
  let router: MockRouter;
  let takeOver: Mock<(document: BilletDocument) => Promise<BilletDetailDto>>;
  let localId: string;
  let model: WritableSignal<BilletDocument>;
  let session: LocalEditorSession;

  beforeEach(() => {
    localStorage.clear();
    router = createMockRouter();
    takeOver = vi.fn();
    TestBed.configureTestingModule({
      imports: [translateTestingModule()],
      providers: [
        { provide: Router, useValue: router },
        { provide: AuthApi, useValue: createMockAuthApi({ user: testUser({ id: 7 }) }) },
        { provide: BilletApi, useValue: { takeOver } },
        {
          provide: ActivatedRoute,
          useFactory: () => ({
            ...createMockActivatedRoute({}, { localId }),
            paramMap: of(convertToParamMap({ localId })),
          }),
        },
      ],
    });
    store = TestBed.inject(LocalBilletStore);
    localId = store.create(createDocument({ lang: 'de', templateId: 'muttertag' }));
    model = signal(createDocument({ lang: 'de' }));
    session = TestBed.runInInjectionContext(
      () =>
        new LocalEditorSession({
          model,
          adopt: (document) => model.set(document),
          commit: (update) => model.update(update),
        }),
    );
  });

  it('the device copy goes only once the account has the billet, and never comes back', async () => {
    let answer!: (billet: BilletDetailDto) => void;
    takeOver.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const sent = model();

    const moving = session.takeOver();
    expect(takeOver).toHaveBeenCalledWith(sent);
    expect(store.load(localId)).not.toBeNull();
    // Typed while the request was out: it follows as the account billet's backup.
    model.update((document) => ({ ...document, title: 'Later' }));
    answer({ id: 42, version: 0 } as BilletDetailDto);
    await moving;

    expect(store.load(localId)).toBeNull();
    expect(readBackup(7, 42)).toMatchObject({ version: 0, document: { title: 'Later' } });
    expect(router.navigate).toHaveBeenCalledWith(['/billets', 42, 'edit'], { replaceUrl: true });
    TestBed.resetTestingModule();
    expect(store.load(localId)).toBeNull();
  });

  it('a full account keeps the billet on this device and says so', async () => {
    takeOver.mockRejectedValue(
      new HttpErrorResponse({ status: 409, error: { errorCode: 'BILLET_LIMIT_REACHED' } }),
    );

    await session.takeOver();

    expect(session.accountFull()).toBe(true);
    expect(session.takingOver()).toBe(false);
    expect(store.load(localId)).not.toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
