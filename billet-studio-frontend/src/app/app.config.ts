import {
  ApplicationConfig,
  inject,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideSignalFormsConfig } from '@angular/forms/signals';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';

import { routes } from './app.routes';
import { sessionCookieInterceptor } from './core/interceptors/session-cookie-interceptor';
import { authTokenInterceptor } from './core/interceptors/auth-token-interceptor';
import { loadingInterceptor } from './core/interceptors/loading-interceptor';
import { errorInterceptor } from './core/interceptors/error-interceptor';
import { refreshTokenInterceptor } from './core/interceptors/refresh-token-interceptor';
import { AuthApi } from './core/services/auth-api';
import { SessionClock } from './core/services/session-clock';
import { LanguageService } from './core/services/language-service';
import { TranslationLoader } from './core/services/translation-loader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => inject(AuthApi).restoreSession()),
    // Nothing injects the clock, so without this it would never be created.
    provideAppInitializer(() => void inject(SessionClock)),
    provideAppInitializer(() => inject(LanguageService).whenReady()),
    // Read once at bootstrap, after the initializers, so it is the language actually loaded. A pipe
    // that must follow a runtime switch passes LanguageService.locale() explicitly.
    { provide: LOCALE_ID, useFactory: () => inject(LanguageService).locale() },
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
    // FetchBackend is the default in v22, withFetch() is deprecated.
    provideHttpClient(
      // Order matters on the way BACK: the last interceptor sees an error first. refreshTokenInterceptor
      // is last so a renewable 401 is renewed and retried before errorInterceptor ever learns of it -
      // a successful retry never reaches the toast at all.
      withInterceptors([
        sessionCookieInterceptor,
        authTokenInterceptor,
        loadingInterceptor,
        errorInterceptor,
        refreshTokenInterceptor,
      ]),
    ),
    provideTranslateService({
      fallbackLang: 'de',
      loader: provideTranslateLoader(TranslationLoader),
    }),
    // The invalid border on every [formField] element, applied by the directive itself. No template
    // binds ui-invalid by hand; form-contract.spec.ts rejects any that tries.
    provideSignalFormsConfig({
      classes: { 'ui-invalid': (f) => f.state().touched() && f.state().invalid() },
    }),
  ],
};
