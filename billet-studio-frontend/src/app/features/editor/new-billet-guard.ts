import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { createDocument } from '../../billet/billet-document';
import { TEMPLATE_IDS, type TemplateId } from '../../billet/templates/templates';
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
 * /billets/new?template=<id>: stores a new billet on this device - the template's in the current
 * interface language, or a blank one without a known template - and redirects into its editor. A
 * guard's redirect never puts /billets/new into the history, so Back does not create another one.
 * When the billet cannot be stored the toast says why and the list is where to make room.
 */
export const newBilletGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const param = route.queryParamMap.get('template');
  const templateId = isTemplateId(param) ? param : null;
  const lang = inject(LanguageService).currentLang();
  const document = createDocument({ lang, templateId: templateId ?? undefined });

  try {
    const localId = inject(LocalBilletStore).create(document, templateId);
    return router.createUrlTree(['/billets/local', localId, 'edit']);
  } catch (error) {
    if (!(error instanceof LocalBilletError)) throw error;
    inject(MessageStore).addMessage('error', error.code, undefined, { max: MAX_LOCAL_BILLETS });
    return router.createUrlTree(['/billets']);
  }
};
