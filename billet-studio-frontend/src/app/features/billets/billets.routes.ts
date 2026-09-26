import type { Routes } from '@angular/router';

import { authGuard } from '../../core/guards/auth-guard';
import type { Editor } from '../editor/editor';
import { newBilletGuard } from '../editor/new-billet-guard';

/** Saved work leaves at once; leaving asks only when the edits could not be kept anywhere. */
const leaveEditor = (editor: Editor) => editor.confirmLeave();

/**
 * /billets and below, loaded as one lazy chunk (the local store, migration and the templates stay
 * out of the initial bundle). Open to guests: their billets live on this device. A signed-in
 * user's new billets live in the account (/billets/:id/edit).
 */
export const BILLET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./billet-list/billet-list').then((m) => m.BilletList),
  },
  // A guest never sees the page: the guard stores the new billet and redirects into its editor. A
  // signed-in user sees the editor's skeleton while the account creates it.
  {
    path: 'new',
    canActivate: [newBilletGuard],
    loadComponent: () => import('../editor/new-billet').then((m) => m.NewBillet),
    data: { breadcrumb: 'BREADCRUMB.NEW_BILLET' },
  },
  {
    path: 'local/:localId/edit',
    loadComponent: () => import('../editor/editor').then((m) => m.Editor),
    canDeactivate: [leaveEditor],
    data: { breadcrumb: 'BREADCRUMB.EDIT_BILLET', breadcrumbDynamic: true },
  },
  {
    path: ':id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('../editor/editor').then((m) => m.Editor),
    canDeactivate: [leaveEditor],
    data: { breadcrumb: 'BREADCRUMB.EDIT_BILLET', breadcrumbDynamic: true },
  },
];
