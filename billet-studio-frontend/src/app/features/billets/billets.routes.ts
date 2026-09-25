import type { Routes } from '@angular/router';

import type { Editor } from '../editor/editor';
import { newBilletGuard } from '../editor/new-billet-guard';

/**
 * /billets and below, loaded as one lazy chunk (the local store, migration and the templates stay
 * out of the initial bundle). Open to guests: their billets live on this device.
 */
export const BILLET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./billet-list/billet-list').then((m) => m.BilletList),
  },
  // Never shown: the guard stores the new billet and redirects into its editor.
  {
    path: 'new',
    canActivate: [newBilletGuard],
    children: [],
    data: { breadcrumb: 'BREADCRUMB.NEW_BILLET' },
  },
  {
    path: 'local/:localId/edit',
    loadComponent: () => import('../editor/editor').then((m) => m.Editor),
    // Local drafts save themselves; leaving only asks when the last write failed.
    canDeactivate: [(editor: Editor) => editor.confirmLeave()],
    data: { breadcrumb: 'BREADCRUMB.EDIT_BILLET', breadcrumbDynamic: true },
  },
];
