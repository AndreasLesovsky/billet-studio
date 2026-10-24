import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth-guard';
import { guestGuard } from './core/guards/guest-guard';
import { requireRole } from './core/guards/role-guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes-guard';

// Dev routes exist only in a development build: isDevMode() alone is a runtime call, so their lazy
// chunks were still emitted. The optimizer defines ngDevMode as false in a production build; written
// inline in each condition (a shared const is not folded), that drops the branch and its imports.

// Visual QA of the design system; never part of a production build.
const devRoutes: Routes =
  (typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode()
    ? [
        {
          path: 'dev/ui',
          loadComponent: () => import('./features/dev/ui-kit/ui-kit').then((m) => m.UiKit),
          data: { breadcrumb: 'BREADCRUMB.UI_KIT' },
        },
      ]
    : [];

// Visual QA of the billet renderer (templates, the parity fixture), chrome-less like /b/:shareToken.
const devBareRoutes: Routes =
  (typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode()
    ? [
        {
          path: 'dev/billet/:templateId',
          loadComponent: () => import('./layout/bare-layout/bare-layout').then((m) => m.BareLayout),
          children: [
            {
              path: '',
              loadComponent: () =>
                import('./features/dev/billet-preview/billet-preview').then((m) => m.BilletPreview),
            },
          ],
        },
        // The home page hero's textures, for tools/asset-pipeline/hero/capture-hero.mjs.
        {
          path: 'dev/hero-capture/:kind',
          loadComponent: () => import('./layout/bare-layout/bare-layout').then((m) => m.BareLayout),
          children: [
            {
              path: '',
              loadComponent: () =>
                import('./features/dev/hero-capture/hero-capture').then((m) => m.HeroCapture),
            },
          ],
        },
        // The home page's 3D story alone: inspection, and the poster capture.
        {
          path: 'dev/hero',
          loadComponent: () => import('./layout/bare-layout/bare-layout').then((m) => m.BareLayout),
          children: [
            {
              path: '',
              loadComponent: () =>
                import('./features/dev/hero-preview/hero-preview').then((m) => m.HeroPreview),
            },
          ],
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
  // The recipient's view of a shared billet: no chrome. The page itself answers a link that leads
  // nowhere (unknown, unpublished, owner inactive).
  {
    path: 'b/:shareToken',
    loadComponent: () => import('./layout/bare-layout/bare-layout').then((m) => m.BareLayout),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/public-billet/public-billet').then((m) => m.PublicBillet),
      },
    ],
  },
  ...devBareRoutes,
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
      // Open to guests: their billets live on this device. The list, /billets/new and the editor.
      {
        path: 'billets',
        data: { breadcrumb: 'BREADCRUMB.BILLETS' },
        loadChildren: () =>
          import('./features/billets/billets.routes').then((m) => m.BILLET_ROUTES),
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
      {
        path: 'admin/billets',
        canActivate: [requireRole('ROLE_ADMIN')],
        loadComponent: () =>
          import('./features/admin/billet-list/billet-list').then((m) => m.BilletList),
        data: { breadcrumb: 'BREADCRUMB.ADMIN_BILLETS' },
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
