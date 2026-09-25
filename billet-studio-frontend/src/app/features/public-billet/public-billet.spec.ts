import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDocument } from '../../billet/billet-document';
import type { PublicBilletDto } from '../../core/models/models';
import { LanguageService } from '../../core/services/language-service';
import { PublicBilletApi } from '../../core/services/public-billet-api';
import { PublicBillet } from './public-billet';

const robots = () => document.head.querySelectorAll('meta[name="robots"]');

describe('PublicBillet', () => {
  afterEach(() => {
    document.title = '';
    document.documentElement.lang = '';
  });

  it('owns the title, the language and noindex while shown, and leaving restores them', async () => {
    document.title = 'billet-studio';
    document.documentElement.lang = 'de';
    const billet: PublicBilletDto = {
      document: createDocument({ lang: 'en', templateId: 'geburtstag' }),
      model: null,
      publishedAt: '2026-05-10T06:00:00Z',
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PublicBilletApi, useValue: { get: vi.fn(async () => billet) } },
        { provide: LanguageService, useValue: { currentLang: signal('de') } },
      ],
    });
    // Loads async and renders the billet view: the page logic is under test, not the template.
    TestBed.overrideComponent(PublicBillet, { set: { template: '<div></div>', imports: [] } });
    const fixture = TestBed.createComponent(PublicBillet);
    fixture.componentRef.setInput('shareToken', 'tok_en-22');
    await fixture.whenStable();

    expect(document.title).toBe('Happy birthday');
    expect(document.documentElement.lang).toBe('en');
    expect(robots()).toHaveLength(1);
    expect(robots()[0].getAttribute('content')).toBe('noindex');

    fixture.destroy();

    expect(document.title).toBe('billet-studio');
    expect(document.documentElement.lang).toBe('de');
    expect(robots()).toHaveLength(0);
  });
});
