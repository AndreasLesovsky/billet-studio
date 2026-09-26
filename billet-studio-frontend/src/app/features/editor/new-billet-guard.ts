import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { createDocument, type BilletDocument, type BilletLang } from '../../billet/billet-document';
import { TEMPLATE_IDS, type TemplateId } from '../../billet/templates/templates';
import { hasSession } from '../../core/guards/session-check';
import { AccessToken } from '../../core/services/access-token';
import { AuthApi } from '../../core/services/auth-api';
import { LanguageService } from '../../core/services/language-service';
import {
  LocalBilletError,
  LocalBilletStore,
  MAX_LOCAL_BILLETS,
} from '../../core/services/local-billet-store';
import { MessageStore } from '../../core/stores/message-store';

const isTemplateId = (value: string | null): value is TemplateId =>
  TEMPLATE_IDS.some((id) => id === value);

/**
 * The document /billets/new?template=<id> starts with: the template's in `lang`, or a blank one
 * without a known template.
 */
export function startDocument(
  template: string | null,
  lang: BilletLang,
): { document: BilletDocument; templateId: TemplateId | null } {
  const templateId = isTemplateId(template) ? template : null;
  return { document: createDocument({ lang, templateId: templateId ?? undefined }), templateId };
}

/**
 * /billets/new?template=<id>. A signed-in user goes on to the page that creates the billet in the
 * account (NewBillet). A guest's billet is stored on this device right here - the template's in
 * the current interface language - and the guard redirects into its editor; a guard's redirect
 * never puts /billets/new into the history, so Back does not create another one. When the billet
 * cannot be stored the toast says why and the list is where to make room.
 */
export const newBilletGuard: CanActivateFn = async (route) => {
  // Every inject() before the first await: the injection context ends there.
  const router = inject(Router);
  const auth = inject(AuthApi);
  const accessToken = inject(AccessToken);
  const store = inject(LocalBilletStore);
  const messages = inject(MessageStore);
  const lang = inject(LanguageService).currentLang();

  if (await hasSession(auth, accessToken)) return true;

  const { document, templateId } = startDocument(route.queryParamMap.get('template'), lang);
  try {
    const localId = store.create(document, templateId);
    return router.createUrlTree(['/billets/local', localId, 'edit']);
  } catch (error) {
    if (!(error instanceof LocalBilletError)) throw error;
    messages.addMessage('error', error.code, undefined, { max: MAX_LOCAL_BILLETS });
    return router.createUrlTree(['/billets']);
  }
};
