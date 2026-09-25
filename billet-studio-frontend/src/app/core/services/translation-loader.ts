import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { SKIP_ERROR_TOAST } from '../interceptors/http-context-tokens';
import { APP_VERSION } from '../version';

/**
 * Loads public/i18n/<lang>.json. Relative to the base href, and versioned so a deployment never
 * serves last release's keys from the browser cache.
 *
 * No error toast: its text would have to come from the very file that failed to load.
 */
@Injectable()
export class TranslationLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`i18n/${lang}.json`, {
      params: { v: APP_VERSION },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }
}
