import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import type { BilletDocument } from '../../billet/billet-document';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
import { BilletApi } from '../../core/services/billet-api';
import { LanguageService } from '../../core/services/language-service';
import { createMockActivatedRoute, createMockRouter } from '../../../test-helpers';
import { NewBillet } from './new-billet';

describe('NewBillet', () => {
  it("creates the billet in the account from the link's start params", async () => {
    const create = vi.fn(async (_document: BilletDocument) => ({ id: 42 }));
    const router = createMockRouter();
    TestBed.configureTestingModule({
      providers: [
        { provide: BilletApi, useValue: { create } },
        { provide: AssetCatalogApi, useValue: { list: vi.fn(async () => []) } },
        { provide: Router, useValue: router },
        { provide: LanguageService, useValue: { currentLang: signal('de') } },
        {
          provide: ActivatedRoute,
          useValue: createMockActivatedRoute({
            template: 'weihnachten',
            theme: 'neon',
            particles: 'none',
            lang: 'en',
          }),
        },
      ],
    });
    TestBed.overrideComponent(NewBillet, { set: { template: '<div></div>', imports: [] } });

    TestBed.createComponent(NewBillet);
    await vi.waitFor(() => expect(router.navigate).toHaveBeenCalled());

    expect(create.mock.calls[0][0]).toMatchObject({
      theme: 'neon',
      lang: 'en',
      particles: { enabled: false },
    });
    expect(router.navigate).toHaveBeenCalledWith(['/billets', 42, 'edit'], { replaceUrl: true });
  });
});
