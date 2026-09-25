import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { siteName } from '../../core/environments/environment';
import { AccountMenu } from '../../shared/components/account-menu/account-menu';
import { Breadcrumb } from '../../shared/components/breadcrumb/breadcrumb';
import {
  BreadcrumbItem,
  BreadcrumbService,
} from '../../shared/components/breadcrumb/breadcrumb-service';
import { ColorModeMenu } from '../../shared/components/color-mode-menu/color-mode-menu';
import { LanguageSwitch } from '../../shared/components/language-switch/language-switch';
import { LoadingBar } from '../../shared/components/loading-bar/loading-bar';

/**
 * The chrome around every page except the shared billet (see BareLayout): header with wordmark,
 * main navigation, language switch, colour-mode menu and account menu, and the global activity bar
 * on its bottom edge; the breadcrumb above the routed page; a minimal footer. The site has one
 * fixed design (the Studio theme), so the header offers the colour mode only, never a theme.
 */
@Component({
  selector: 'app-shell',
  imports: [
    AccountMenu,
    Breadcrumb,
    ColorModeMenu,
    LanguageSwitch,
    LoadingBar,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly year = new Date().getFullYear();

  constructor() {
    // The page title follows the breadcrumb: translated, relabelled on a language switch, and it
    // carries the runtime labels of detail pages (a user's name) too.
    const title = inject(Title);
    const crumbs = inject(BreadcrumbService).items;
    effect(() => title.setTitle(pageTitle(crumbs())));
  }
}

/** "<page> – <site>"; the home page (a single crumb) is the site name alone. */
function pageTitle(crumbs: BreadcrumbItem[]): string {
  return crumbs.length > 1 ? `${crumbs[crumbs.length - 1].name} – ${siteName}` : siteName;
}
