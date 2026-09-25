import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Language, LanguageService } from '../../../core/services/language-service';

const LANGUAGE_NAMES: Record<Language, string> = {
  de: 'NAV.LANGUAGE_DE',
  en: 'NAV.LANGUAGE_EN',
};

// Radio names must be unique per instance, or two switches on one page share one group.
let nextId = 0;

/**
 * DE | EN as a native radio group, so arrow keys and "1 of 2" come from the browser. The visible
 * code is hidden from assistive tech in favour of the language's own name ("Deutsch", "English"),
 * which starts with the code, so the visible label stays part of the accessible one.
 *
 * Switches this device's UI language only; the account's preferred language (emails) is set on the
 * account page.
 */
@Component({
  selector: 'app-language-switch',
  imports: [TranslatePipe],
  template: `
    <fieldset class="ui-segmented">
      <legend class="ui-visually-hidden">{{ 'NAV.LANGUAGE' | translate }}</legend>
      @for (option of options; track option.lang) {
        <label class="ui-segmented__option" [lang]="option.lang">
          <input
            type="radio"
            [name]="group"
            [value]="option.lang"
            [checked]="current() === option.lang"
            (change)="select(option.lang)"
          />
          <span aria-hidden="true">{{ option.code }}</span>
          <span class="ui-visually-hidden">{{ option.nameKey | translate }}</span>
        </label>
      }
    </fieldset>
  `,
})
export class LanguageSwitch {
  private readonly languageService = inject(LanguageService);

  protected readonly options = this.languageService.availableLanguages.map((lang) => ({
    lang,
    code: lang.toUpperCase(),
    nameKey: LANGUAGE_NAMES[lang],
  }));
  protected readonly current = this.languageService.currentLang;
  protected readonly group = `app-language-switch-${nextId++}`;

  protected select(lang: Language): void {
    this.languageService.setLanguage(lang);
  }
}
