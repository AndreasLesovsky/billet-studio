import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletDocument } from '../../../billet/billet-document';
import { BilletView } from '../../../billet/view/billet-view';
import type { ColorMode } from '../../../core/theme/theme-registry.generated';
import { thumbnailDocument } from './hero-capture-documents';

/**
 * Dev only (hero capture): an ordinary text message on the lock screen - a neutral speech-bubble
 * icon, the sender, one line of text and a link preview whose thumbnail is the billet's hero
 * (the real BilletView, scaled down). No domain, no app branding.
 */
@Component({
  selector: 'app-hero-message',
  imports: [BilletView, TranslatePipe],
  template: `
    <article class="ui-message">
      <header class="ui-message__header">
        <span class="ui-message__icon" aria-hidden="true">
          <i class="bi bi-chat-fill"></i>
        </span>
        <span class="ui-message__sender">{{ 'HERO_CAPTURE.SENDER' | translate }}</span>
        <span class="ui-message__time">{{ 'HERO_CAPTURE.NOW' | translate }}</span>
      </header>
      <p class="ui-message__text">{{ 'HERO_CAPTURE.MESSAGE' | translate }}</p>
      <div class="ui-message__link">
        <span class="ui-message__thumb" aria-hidden="true">
          <app-billet-view
            class="ui-message__billet"
            [document]="thumbnail()"
            [mode]="mode()"
            [animate]="false"
            [particles]="false"
            fill="frame"
          />
        </span>
        <span class="ui-message__title">{{
          'HERO_CAPTURE.LINK_TITLE' | translate: linkParams()
        }}</span>
      </div>
    </article>
  `,
  styleUrl: './hero-message.scss',
})
export class HeroMessage {
  /** The template's own document; the thumbnail shows its hero. */
  readonly document = input.required<BilletDocument>();
  readonly mode = input.required<ColorMode>();
  /** The template's name, translated. */
  readonly templateName = input.required<string>();

  protected readonly thumbnail = computed(() => thumbnailDocument(this.document()));
  protected readonly linkParams = computed(() => ({ name: this.templateName() }));
}
