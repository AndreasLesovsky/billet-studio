import {
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  input,
  resource,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../billet/billet-document';
import { BilletView } from '../../billet/view/billet-view';
import { siteName } from '../../core/environments/environment';
import { LanguageService } from '../../core/services/language-service';
import { PublicBilletApi } from '../../core/services/public-billet-api';
import { billetFontFaces, whenFontsReady } from './billet-fonts';

interface AssetCredit {
  readonly text: string;
  readonly url: string | null;
}

/**
 * The recipient's page of a shared billet, /b/:shareToken (bare layout). The billet shows once its
 * fonts are in, so the reveal never plays in a fallback face. While shown it owns the document's
 * <title> and <html lang>, and the page is noindex; leaving restores all three.
 */
@Component({
  selector: 'app-public-billet',
  imports: [BilletView, RouterLink, TranslatePipe],
  templateUrl: './public-billet.html',
  styleUrl: './public-billet.scss',
})
export class PublicBillet {
  readonly shareToken = input.required<string>();

  private readonly api = inject(PublicBilletApi);
  private readonly document = inject(DOCUMENT);

  /** The credit line is site text inside a billet that may be in the other language. */
  protected readonly uiLang = inject(LanguageService).currentLang;

  protected readonly billet = resource({
    params: () => this.shareToken(),
    loader: async ({ params }) => {
      const billet = await this.api.get(params);
      if (billet) await whenFontsReady(this.document.fonts, billetFontFaces(billet.document));
      return billet;
    },
  });

  protected readonly shown = computed(() => (this.billet.hasValue() ? this.billet.value() : null));
  protected readonly missing = computed(
    () => this.billet.hasValue() && this.billet.value() === null,
  );
  protected readonly failed = computed(() => this.billet.status() === 'error');

  /** CC-BY and the like require the attribution wherever the model is shown. */
  protected readonly credit = computed(() => {
    const credit = this.shown()?.model?.credit?.trim();
    return credit ? splitCredit(credit) : null;
  });

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    const root = this.document.documentElement;
    const before = { title: title.getTitle(), lang: root.lang };
    // Also while loading and for a link that leads nowhere: no share URL belongs in an index.
    const robots = meta.addTag({ name: 'robots', content: 'noindex' });

    effect(() => {
      const document = this.shown()?.document;
      title.setTitle(document ? pageTitle(document) : before.title);
      root.lang = document?.lang ?? before.lang;
    });

    inject(DestroyRef).onDestroy(() => {
      if (robots) meta.removeTagElement(robots);
      title.setTitle(before.title);
      root.lang = before.lang;
    });
  }

  protected retry(): void {
    this.billet.reload();
  }
}

function pageTitle({ pageTitle, hero }: BilletDocument): string {
  const heroText = [hero.titleLine1, hero.titleLine2].filter((line) => line.trim()).join(' ');
  return pageTitle.trim() || heroText.trim() || siteName;
}

/** The asset pipeline writes '<title> by <author> (<licence>) <source url>'; the URL is the link. */
function splitCredit(credit: string): AssetCredit {
  const match = /^(.*\S)\s+(https?:\/\/\S+)$/.exec(credit);
  return match ? { text: match[1], url: match[2] } : { text: credit, url: null };
}
