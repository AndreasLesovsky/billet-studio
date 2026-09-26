import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { BilletLang } from '../../../billet/billet-document';

/** The moment the lock screen shows: always 18:30 on 14 February (a Saturday in 2026). */
const MOMENT = Date.UTC(2026, 1, 14, 18, 30);

const LOCALES: Record<BilletLang, string> = { de: 'de-DE', en: 'en-US' };

/**
 * Dev only (hero capture): a neutral phone lock screen in Studio - a soft violet wallpaper, the
 * date and a large clock, the unlock hint and the home indicator. No status bar, no brand marks.
 */
@Component({
  selector: 'app-hero-lock-screen',
  imports: [TranslatePipe],
  template: `
    <div class="ui-lock-screen">
      <i class="bi bi-lock-fill ui-lock-screen__lock" aria-hidden="true"></i>
      <p class="ui-lock-screen__date">{{ date() }}</p>
      <p class="ui-lock-screen__time">{{ time() }}</p>
      <p class="ui-lock-screen__hint">{{ 'HERO_CAPTURE.UNLOCK_HINT' | translate }}</p>
      <span class="ui-lock-screen__home" aria-hidden="true"></span>
    </div>
  `,
  styleUrl: './hero-lock-screen.scss',
})
export class HeroLockScreen {
  readonly lang = input.required<BilletLang>();

  protected readonly date = computed(() =>
    new Intl.DateTimeFormat(LOCALES[this.lang()], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(MOMENT),
  );

  protected readonly time = computed(() =>
    new Intl.DateTimeFormat(LOCALES[this.lang()], {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }).format(MOMENT),
  );
}
