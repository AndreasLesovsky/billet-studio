import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import type { BilletLang } from '../../billet/billet-document';
import {
  needsLibrary,
  parseStartParams,
  startDocument,
  type StartParams,
} from '../../billet/billet-start';
import { hasSession } from '../../core/guards/session-check';
import type { ModelAssetDto } from '../../core/models/models';
import { AccessToken } from '../../core/services/access-token';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
import { AuthApi } from '../../core/services/auth-api';
import { LanguageService } from '../../core/services/language-service';
import {
  LocalBilletError,
  LocalBilletStore,
  MAX_LOCAL_BILLETS,
} from '../../core/services/local-billet-store';
import { MessageStore } from '../../core/stores/message-store';

/**
 * The document /billets/new starts with (guest and account alike). The library is read only for a
 * model param; when it cannot be read the template keeps its own model.
 */
export async function buildStartDocument(
  params: StartParams,
  uiLang: BilletLang,
  catalog: AssetCatalogApi,
): Promise<ReturnType<typeof startDocument>> {
  let library: readonly ModelAssetDto[] = [];
  if (needsLibrary(params)) library = await catalog.list().catch(() => []);
  return startDocument(params, uiLang, library);
}

/**
 * /billets/new?template=<id>&… (StartParams). A signed-in user goes on to the page that creates the
 * billet in the account (NewBillet). A guest's billet is stored on this device right here - in the
 * interface language unless the link names one - and the guard redirects into its editor; a
 * guard's redirect never puts /billets/new into the history, so Back does not create another one.
 * When the billet cannot be stored the toast says why and the list is where to make room.
 */
export const newBilletGuard: CanActivateFn = async (route) => {
  // Every inject() before the first await: the injection context ends there.
  const router = inject(Router);
  const auth = inject(AuthApi);
  const accessToken = inject(AccessToken);
  const store = inject(LocalBilletStore);
  const catalog = inject(AssetCatalogApi);
  const messages = inject(MessageStore);
  const lang = inject(LanguageService).currentLang();

  if (await hasSession(auth, accessToken)) return true;

  const params = parseStartParams(route.queryParamMap);
  const { document, templateId } = await buildStartDocument(params, lang, catalog);
  try {
    const localId = store.create(document, templateId);
    return router.createUrlTree(['/billets/local', localId, 'edit']);
  } catch (error) {
    if (!(error instanceof LocalBilletError)) throw error;
    messages.addMessage('error', error.code, undefined, { max: MAX_LOCAL_BILLETS });
    return router.createUrlTree(['/billets']);
  }
};
