import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth-guard';
import { guestGuard } from './core/guards/guest-guard';
import { requireRole } from './core/guards/role-guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes-guard';

// Visual QA of the design system; never part of a production build.
const devRoutes: Routes = isDevMode()
  ? [
      {
        path: 'dev/ui',
        loadComponent: () => import('./features/dev/ui-kit/ui-kit').then((m) => m.UiKit),
        data: { breadcrumb: 'BREADCRUMB.UI_KIT' },
      },
    ]
  : [];

/**
 * Every page is lazy, the layouts too: the shared billet page must not pay for the app chrome.
 *
 * Breadcrumbs come from each route's own `data.breadcrumb`. The shell route carries HOME, so every
 * trail starts there; detail routes nest under their list (billets/new, admin/users/:id) so the
 * trail and the mobile back link follow the URL.
 */
export const routes: Routes = [
  // The recipient's view of a shared billet: no chrome. It stays a 404 until the public page (P5)
  // replaces the child, which is also the answer for an unknown or unpublished token.
  {
    path: 'b/:token',
    loadComponent: () => import('./layout/bare-layout/bare-layout').then((m) => m.BareLayout),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
  {
    path: '',
    loadComponent: () => import('./layout/app-shell/app-shell').then((m) => m.AppShell),
    data: { breadcrumb: 'BREADCRUMB.HOME' },
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
      {
        path: 'login',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
        data: { breadcrumb: 'BREADCRUMB.LOGIN' },
      },
      {
        path: 'register',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
        data: { breadcrumb: 'BREADCRUMB.REGISTER' },
      },
      {
        path: 'forgot-password',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password').then((m) => m.ForgotPassword),
        data: { breadcrumb: 'BREADCRUMB.FORGOT_PASSWORD' },
      },
      {
        path: 'reset-password',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password').then((m) => m.ResetPassword),
        data: { breadcrumb: 'BREADCRUMB.RESET_PASSWORD' },
      },
      {
        path: 'templates',
        loadComponent: () =>
          import('./features/templates/template-gallery/template-gallery').then(
            (m) => m.TemplateGallery,
          ),
        data: { breadcrumb: 'BREADCRUMB.TEMPLATES' },
      },
      // Open to guests: their billets live on this device.
      {
        path: 'billets',
        data: { breadcrumb: 'BREADCRUMB.BILLETS' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/billets/billet-list/billet-list').then((m) => m.BilletList),
          },
        ],
      },
      {
        path: 'account',
        canActivate: [authGuard],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/account/account').then((m) => m.Account),
        data: { breadcrumb: 'BREADCRUMB.ACCOUNT' },
      },
      {
        path: 'admin/users',
        canActivate: [requireRole('ROLE_ADMIN')],
        data: { breadcrumb: 'BREADCRUMB.ADMIN_USERS' },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/admin/user-list/user-list').then((m) => m.UserList),
          },
          {
            path: 'new',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/admin/user-form/user-form').then((m) => m.UserForm),
            data: { breadcrumb: 'BREADCRUMB.CREATE_USER' },
          },
          {
            path: ':id',
            canDeactivate: [unsavedChangesGuard],
            loadComponent: () =>
              import('./features/admin/user-form/user-form').then((m) => m.UserForm),
            data: { breadcrumb: 'BREADCRUMB.EDIT_USER', breadcrumbDynamic: true },
          },
        ],
      },
      ...devRoutes,
      {
        path: '**',
        loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFound),
        data: { breadcrumb: 'BREADCRUMB.NOT_FOUND' },
      },
    ],
  },
];
